#include "game_core.h"
#include "web_asset.h"
#include "world_core.h"
#include "avatar_assets.h"
#include "../private/board_config.h"

#include <inttypes.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <sys/time.h>

#include "cJSON.h"
#include "esp_chip_info.h"
#include "esp_event.h"
#include "esp_heap_caps.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_random.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "nvs_flash.h"

#ifndef CONEXA_VERSION
#define CONEXA_VERSION "1.0.0"
#endif
#define MAX_BODY_BYTES 384u
#define BODY_TIMEOUT_US INT64_C(3000000)
#define MAX_TOKEN_BYTES 128u
#define AUTH_HEADER_CAPACITY (MAX_TOKEN_BYTES + 8u)
#define ACTIVE_WINDOW_US INT64_C(20000000)

_Static_assert(sizeof(CONEXA_STUDENT_TOKENS) / sizeof(CONEXA_STUDENT_TOKENS[0]) ==
               GAME_PLAYER_COUNT, "Exactly 44 student tokens are required");

static const char *const TAG = "conexa";
/* Only the HTTP server task accesses these: handlers run sequentially. */
static game_state_t s_game;
static world_state_t s_world;
/* One HTTP task owns this reusable buffer; snapshots do not grow its stack. */
static char s_session_json[GAME_SNAPSHOT_CAPACITY + WORLD_SNAPSHOT_CAPACITY + 32u];
static uint64_t s_requests;
static uint64_t s_errors;
static int64_t s_last_seen[GAME_PLAYER_COUNT];
static bool s_seen[GAME_PLAYER_COUNT];
static esp_netif_t *s_station_netif;
static httpd_handle_t s_httpd;

typedef struct {
    game_role_t role;
    unsigned student_id;
} identity_t;

typedef enum {
    ROUTE_STATE,
    ROUTE_JOIN,
    ROUTE_VOTE,
    ROUTE_CONTROL,
    ROUTE_HEALTH,
    ROUTE_SESSION,
    ROUTE_WORLD,
    ROUTE_WORLD_ACTION
} api_route_t;

typedef enum {
    BODY_OK,
    BODY_TOO_LARGE,
    BODY_JSON_REQUIRED,
    BODY_INCOMPLETE,
    BODY_TIMEOUT,
    BODY_SOCKET_ERROR,
    BODY_INVALID
} body_result_t;

static const char *status_line(unsigned status)
{
    switch (status) {
    case 200: return "200 OK";
    case 304: return "304 Not Modified";
    case 400: return "400 Bad Request";
    case 401: return "401 Unauthorized";
    case 403: return "403 Forbidden";
    case 404: return "404 Not Found";
    case 405: return "405 Method Not Allowed";
    case 408: return "408 Request Timeout";
    case 409: return "409 Conflict";
    case 411: return "411 Length Required";
    case 413: return "413 Content Too Large";
    case 414: return "414 URI Too Long";
    case 431: return "431 Request Header Fields Too Large";
    case 429: return "429 Too Many Requests";
    case 501: return "501 Not Implemented";
    default: return "500 Internal Server Error";
    }
}

static esp_err_t send_bytes(httpd_req_t *req, unsigned status,
                            const char *type, const char *cache,
                            const char *data, size_t length)
{
    (void)httpd_resp_set_status(req, status_line(status));
    (void)httpd_resp_set_type(req, type);
    (void)httpd_resp_set_hdr(req, "Connection", "close");
    (void)httpd_resp_set_hdr(req, "Cache-Control", cache);
    (void)httpd_resp_set_hdr(req, "X-Content-Type-Options", "nosniff");
    (void)httpd_resp_set_hdr(req, "Referrer-Policy", "no-referrer");
    const esp_err_t sent = httpd_resp_send(req, data, (ssize_t)length);
    if (sent != ESP_OK) {
        ++s_errors;
        return ESP_FAIL; /* The HTTP server closes a failed handler's socket. */
    }
    /* The response has already been sent. ESP-IDF documents this return value
     * as closing the session; it does not send another HTTP error response.
     * Close synchronously through the handler result instead of queuing work:
     * a successful handler would first purge an unread oversized/unauthorized
     * body, defeating MAX_BODY_BYTES and tying up the single HTTP task. */
    return ESP_FAIL;
}

static esp_err_t send_error(httpd_req_t *req, unsigned status,
                            const char *code, const char *message)
{
    /* Both strings are constants below; request data is never reflected. */
    char response[256];
    ++s_errors;
    const int n = snprintf(response, sizeof(response),
                           "{\"error\":\"%s\",\"message\":\"%s\"}", code, message);
    if (n < 0 || (size_t)n >= sizeof(response)) {
        return ESP_FAIL;
    }
    if (status == 401u) {
        (void)httpd_resp_set_hdr(req, "WWW-Authenticate", "Bearer");
    }
    return send_bytes(req, status, "application/json; charset=utf-8", "no-store",
                      response, (size_t)n);
}

static esp_err_t send_game_error(httpd_req_t *req, game_result_t result)
{
    switch (result) {
    case GAME_INVALID_ARGUMENT:
        return send_error(req, 400, "INVALID_ARGUMENT", "Os dados enviados nÃ£o tÃªm o formato esperado.");
    case GAME_NOT_JOINED:
        return send_error(req, 403, "NOT_JOINED", "Entre com seu cÃ³digo antes de enviar uma escolha.");
    case GAME_ROUND_CONFLICT:
        return send_error(req, 409, "ROUND_CHANGED", "A partida ou a rodada mudou. Atualize o estado antes de agir.");
    case GAME_PHASE_CONFLICT:
        return send_error(req, 409, "PHASE_CONFLICT", "Essa aÃ§Ã£o nÃ£o estÃ¡ disponÃ­vel na fase atual.");
    case GAME_SEQUENCE_CONFLICT:
        return send_error(req, 409, "SEQUENCE_CONFLICT", "A sequÃªncia da escolha estÃ¡ em conflito. Consulte o estado atual.");
    case GAME_COUNTER_LIMIT:
        return send_error(req, 409, "COUNTER_LIMIT", "O contador desta execuÃ§Ã£o atingiu seu limite.");
    case GAME_OK:
        break;
    }
    return send_error(req, 500, "INTERNAL_ERROR", "NÃ£o foi possÃ­vel concluir a solicitaÃ§Ã£o.");
}

static bool token_equal(const char *expected, const char *supplied)
{
    const size_t expected_len = strlen(expected);
    const size_t supplied_len = strlen(supplied);
    unsigned difference = (unsigned)(expected_len ^ supplied_len);
    /* Compare the full bounded token space without a prefix-dependent exit. */
    for (size_t i = 0; i < MAX_TOKEN_BYTES; ++i) {
        const unsigned left = i < expected_len ? (unsigned char)expected[i] : 0u;
        const unsigned right = i < supplied_len ? (unsigned char)supplied[i] : 0u;
        difference |= left ^ right;
    }
    return difference == 0u;
}

static bool read_identity(httpd_req_t *req, identity_t *identity)
{
    *identity = (identity_t){.role = GAME_ROLE_VISITOR, .student_id = 0u};
    char authorization[AUTH_HEADER_CAPACITY];
    if (httpd_req_get_hdr_value_len(req, "Authorization") >= sizeof(authorization)) {
        return false;
    }
    /* Reading the header distinguishes absence from an explicitly empty value. */
    const esp_err_t found = httpd_req_get_hdr_value_str(req, "Authorization",
                                                      authorization, sizeof(authorization));
    if (found == ESP_ERR_NOT_FOUND) {
        return true;
    }
    if (found != ESP_OK || strncasecmp(authorization, "Bearer ", 7u) != 0 ||
        authorization[7] == '\0') {
        return false;
    }
    const char *const token = authorization + 7u;
    if (strlen(token) > MAX_TOKEN_BYTES) {
        return false;
    }
    if (token_equal(CONEXA_ADMIN_TOKEN, token)) {
        identity->role = GAME_ROLE_TEACHER;
        return true;
    }
    for (unsigned i = 0; i < GAME_PLAYER_COUNT; ++i) {
        if (token_equal(CONEXA_STUDENT_TOKENS[i], token)) {
            identity->role = GAME_ROLE_STUDENT;
            identity->student_id = i + 1u;
            return true;
        }
    }
    return false;
}

static esp_err_t send_snapshot(httpd_req_t *req, const identity_t *identity)
{
    char response[GAME_SNAPSHOT_CAPACITY];
    const size_t length = game_snapshot_json(&s_game, identity->role,
                                             identity->student_id, response, sizeof(response));
    if (length == 0u) {
        return send_error(req, 500, "SNAPSHOT_ERROR", "NÃ£o foi possÃ­vel montar o estado da partida.");
    }
    return send_bytes(req, 200, "application/json; charset=utf-8", "no-store", response, length);
}

static esp_err_t send_session(httpd_req_t *req, const identity_t *identity)
{
    size_t used = 6u;
    memcpy(s_session_json, "{\"p0\":", used);
    size_t n = game_snapshot_json(&s_game, identity->role, identity->student_id,
                                  s_session_json + used, sizeof(s_session_json) - used);
    if (n == 0u) return send_error(req, 500, "SNAPSHOT_ERROR", "Estado indisponÃ­vel.");
    used += n;
    memcpy(s_session_json + used, ",\"world\":", 9u); used += 9u;
    n = world_snapshot_json(&s_world, identity->role, identity->student_id,
                             s_session_json + used, sizeof(s_session_json) - used - 1u);
    if (n == 0u) return send_error(req, 500, "SNAPSHOT_ERROR", "Mundo indisponÃ­vel.");
    used += n; s_session_json[used++] = '}';
    return send_bytes(req, 200, "application/json; charset=utf-8", "no-store", s_session_json, used);
}

static esp_err_t send_world_error(httpd_req_t *req, world_result_t result)
{
    unsigned status = 409u;
    if (result == WORLD_INVALID_ARGUMENT) status = 400u;
    else if (result == WORLD_FORBIDDEN || result == WORLD_NOT_JOINED) status = 403u;
    else if (result == WORLD_RATE_LIMIT) status = 429u;
    const char *message = "O estado mudou. Consulte o mundo antes de agir novamente.";
    if (result == WORLD_TOO_FAR) message = "Aproxime seu avatar do local para interagir.";
    else if (result == WORLD_COLLISION) message = "Escolha um caminho livre na cidade.";
    else if (result == WORLD_EVIDENCE_REQUIRED) message = "ReÃºna as quatro pistas e confira as relaÃ§Ãµes entre afirmaÃ§Ãµes e evidÃªncias.";
    else if (result == WORLD_NOT_RELEASED) message = "Aguarde o professor liberar este acontecimento.";
    else if (result == WORLD_PHASE_CONFLICT) message = "A exploraÃ§Ã£o aguarda o inÃ­cio ou a retomada pelo professor.";
    else if (result == WORLD_RATE_LIMIT) message = "Aguarde a confirmaÃ§Ã£o do prÃ³ximo deslocamento.";
    else if (result == WORLD_ALREADY_COMPLETED) message = "Esta missÃ£o jÃ¡ foi concluÃ­da e estÃ¡ registrada.";
    return send_error(req, status, world_result_name(result), message);
}

static bool flat_json_guard(const char *body, size_t length)
{
    /* The protocol only accepts flat objects. Bound parser depth before cJSON
     * to prevent a small deeply nested body from exhausting the HTTP stack. */
    if (memchr(body, '\0', length) != NULL || strstr(body, "\\u0000") != NULL) {
        return false;
    }
    bool in_string = false;
    bool escaped = false;
    unsigned depth = 0;
    for (size_t i = 0; i < length; ++i) {
        const char c = body[i];
        if (in_string) {
            if (escaped) {
                escaped = false;
            } else if (c == '\\') {
                escaped = true;
            } else if (c == '"') {
                in_string = false;
            }
        } else if (c == '"') {
            in_string = true;
        } else if (c == '[' || c == ']') {
            return false;
        } else if (c == '-' || (c >= '0' && c <= '9')) {
            /* Every numeric field in this protocol is an integer. Requiring
             * decimal integer literals prevents cJSON/strtod from accepting
             * leading zeros, overflow/underflow or rounding a fractional value.
             * The browser emits this canonical representation with stringify. */
            size_t end = i + (c == '-' ? 1u : 0u);
            if (end >= length || body[end] < '0' || body[end] > '9') {
                return false;
            }
            if (body[end] == '0' && end + 1u < length &&
                body[end + 1u] >= '0' && body[end + 1u] <= '9') {
                return false;
            }
            while (end < length && body[end] >= '0' && body[end] <= '9') {
                ++end;
            }
            if (end < length && (body[end] == '.' || body[end] == 'e' || body[end] == 'E')) {
                return false;
            }
            i = end - 1u;
        } else if (c == '{') {
            if (++depth > 1u) {
                return false;
            }
        } else if (c == '}') {
            if (depth == 0u) {
                return false;
            }
            --depth;
        }
    }
    return !in_string && depth == 0u;
}

static bool content_type_is_json(httpd_req_t *req)
{
    char content_type[96];
    if (httpd_req_get_hdr_value_len(req, "Content-Type") >= sizeof(content_type) ||
        httpd_req_get_hdr_value_str(req, "Content-Type", content_type, sizeof(content_type)) != ESP_OK ||
        strncasecmp(content_type, "application/json", 16u) != 0) {
        return false;
    }
    const char *tail = content_type + 16u;
    while (*tail == ' ' || *tail == '\t') {
        ++tail;
    }
    return *tail == '\0' || *tail == ';';
}

static body_result_t read_json_body(httpd_req_t *req, cJSON **parsed)
{
    *parsed = NULL;
    if (req->content_len > MAX_BODY_BYTES) {
        return BODY_TOO_LARGE;
    }
    if (!content_type_is_json(req)) {
        return BODY_JSON_REQUIRED;
    }
    if (req->content_len == 0u) {
        return BODY_INVALID;
    }
    const int sockfd = httpd_req_to_sockfd(req);
    if (sockfd < 0) {
        return BODY_SOCKET_ERROR;
    }
    const int64_t deadline = esp_timer_get_time() + BODY_TIMEOUT_US;
    char body[MAX_BODY_BYTES + 1u];
    size_t received = 0u;
    while (received < req->content_len) {
        const int64_t remaining_us = deadline - esp_timer_get_time();
        /* lwIP truncates SO_RCVTIMEO to milliseconds; zero means no timeout.
         * Stop below 1 ms instead of accidentally configuring an infinite wait.
         * Each read uses the remaining total budget, not a fresh three seconds. */
        if (remaining_us < INT64_C(1000)) {
            return BODY_TIMEOUT;
        }
        const struct timeval timeout = {
            .tv_sec = (time_t)(remaining_us / INT64_C(1000000)),
            .tv_usec = (suseconds_t)(remaining_us % INT64_C(1000000))
        };
        if (setsockopt(sockfd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout)) < 0) {
            return BODY_SOCKET_ERROR;
        }
        const int n = httpd_req_recv(req, body + received, req->content_len - received);
        /* Scheduler/socket timeout resolution may return after the deadline.
         * Even a complete body arriving late must not reach game mutation. */
        if (esp_timer_get_time() >= deadline || n == HTTPD_SOCK_ERR_TIMEOUT) {
            return BODY_TIMEOUT;
        }
        if (n <= 0) {
            return BODY_INCOMPLETE;
        }
        received += (size_t)n;
    }
    body[received] = '\0';
    if (!flat_json_guard(body, received)) {
        return BODY_INVALID;
    }
    cJSON *object = cJSON_ParseWithLengthOpts(body, received + 1u, NULL, true);
    if (!cJSON_IsObject(object)) {
        cJSON_Delete(object);
        return BODY_INVALID;
    }
    *parsed = object;
    return BODY_OK;
}

static bool exact_fields(const cJSON *object, const char *const *names, unsigned count)
{
    unsigned seen = 0u;
    unsigned actual = 0u;
    for (const cJSON *item = object->child; item != NULL; item = item->next) {
        bool known = false;
        for (unsigned i = 0; i < count; ++i) {
            if (item->string != NULL && strcmp(item->string, names[i]) == 0) {
                const unsigned bit = 1u << i;
                if ((seen & bit) != 0u) {
                    return false; /* No duplicate, including escaped-key aliases. */
                }
                seen |= bit;
                known = true;
                break;
            }
        }
        if (!known || ++actual > count) {
            return false;
        }
    }
    return actual == count;
}

static bool json_uint32(const cJSON *object, const char *name,
                         uint32_t minimum, uint32_t maximum, uint32_t *value)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(object, name);
    if (!cJSON_IsNumber(item)) {
        return false;
    }
    const double number = item->valuedouble;
    /* These comparisons also reject NaN/infinity before the integer cast. */
    if (!(number >= (double)minimum && number <= (double)maximum)) {
        return false;
    }
    const uint32_t integer = (uint32_t)number;
    if ((double)integer != number) {
        return false;
    }
    *value = integer;
    return true;
}

static const char *json_string(const cJSON *object, const char *name)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(object, name);
    return cJSON_IsString(item) ? item->valuestring : NULL;
}

static esp_err_t health_response(httpd_req_t *req)
{
    const int64_t now = esp_timer_get_time();
    unsigned active_students = 0u;
    for (unsigned i = 0; i < GAME_PLAYER_COUNT; ++i) {
        if (s_game.players[i].joined && s_seen[i] && now >= s_last_seen[i] &&
            now - s_last_seen[i] <= ACTIVE_WINDOW_US) {
            ++active_students;
        }
    }
    esp_chip_info_t chip;
    esp_chip_info(&chip);
    const char *const chip_name = chip.model == CHIP_ESP32C6 ? "ESP32-C6" : "unknown";
    wifi_ap_record_t access_point;
    char rssi[16] = "null";
    if (esp_wifi_sta_get_ap_info(&access_point) == ESP_OK) {
        (void)snprintf(rssi, sizeof(rssi), "%d", (int)access_point.rssi);
    }
    esp_netif_ip_info_t ip_info;
    char ip[24] = "null";
    if (esp_netif_get_ip_info(s_station_netif, &ip_info) == ESP_OK) {
        (void)snprintf(ip, sizeof(ip), "\"" IPSTR "\"", IP2STR(&ip_info.ip));
    }
    char response[512];
    const int n = snprintf(response, sizeof(response),
        "{\"version\":\"%s\",\"chip\":\"%s\",\"boot\":\"%s\","
        "\"uptime_s\":%" PRIu64 ",\"heap_free\":%zu,\"heap_min\":%zu,"
        "\"heap_largest\":%zu,\"requests\":%" PRIu64 ",\"errors\":%" PRIu64 ","
        "\"rssi\":%s,\"ip\":%s,\"active_students\":%u}",
        CONEXA_VERSION, chip_name, s_game.boot, (uint64_t)(now / INT64_C(1000000)),
        heap_caps_get_free_size(MALLOC_CAP_8BIT),
        heap_caps_get_minimum_free_size(MALLOC_CAP_8BIT),
        heap_caps_get_largest_free_block(MALLOC_CAP_8BIT),
        s_requests, s_errors, rssi, ip, active_students);
    if (n < 0 || (size_t)n >= sizeof(response)) {
        return send_error(req, 500, "HEALTH_ERROR", "NÃ£o foi possÃ­vel montar os dados de saÃºde.");
    }
    return send_bytes(req, 200, "application/json; charset=utf-8", "no-store", response, (size_t)n);
}

static esp_err_t api_request(httpd_req_t *req, api_route_t route)
{
    ++s_requests;
    identity_t identity;
    if (!read_identity(req, &identity)) {
        return send_error(req, 401, "INVALID_TOKEN", "O cÃ³digo informado Ã© invÃ¡lido.");
    }
    if (req->method == HTTP_GET && req->content_len != 0u) {
        return send_error(req, 400, "UNEXPECTED_BODY", "Esta consulta nÃ£o recebe um corpo de dados.");
    }
    if (route == ROUTE_STATE || route == ROUTE_SESSION || route == ROUTE_WORLD) {
        if (identity.role == GAME_ROLE_STUDENT && s_game.players[identity.student_id - 1u].joined) {
            s_last_seen[identity.student_id - 1u] = esp_timer_get_time();
            s_seen[identity.student_id - 1u] = true;
        }
        if (route == ROUTE_SESSION) return send_session(req, &identity);
        if (route == ROUTE_WORLD) {
            const size_t n = world_snapshot_json(&s_world, identity.role, identity.student_id,
                                                  s_session_json, sizeof(s_session_json));
            if (n == 0u) return send_error(req, 500, "SNAPSHOT_ERROR", "Mundo indisponÃ­vel.");
            return send_bytes(req, 200, "application/json; charset=utf-8", "no-store", s_session_json, n);
        }
        return send_snapshot(req, &identity);
    }
    const game_role_t required_role = route == ROUTE_CONTROL || route == ROUTE_HEALTH
                                      ? GAME_ROLE_TEACHER : GAME_ROLE_STUDENT;
    if (identity.role == GAME_ROLE_VISITOR) {
        return send_error(req, 401, "TOKEN_REQUIRED", "Informe o cÃ³digo de acesso para continuar.");
    }
    if (route != ROUTE_WORLD_ACTION && identity.role != required_role) {
        return send_error(req, 403, "ROLE_FORBIDDEN", "Seu acesso nÃ£o permite essa aÃ§Ã£o.");
    }
    if (route == ROUTE_HEALTH) {
        return health_response(req);
    }

    cJSON *body = NULL;
    const body_result_t body_result = read_json_body(req, &body);
    switch (body_result) {
    case BODY_TOO_LARGE:
        return send_error(req, 413, "BODY_TOO_LARGE", "O corpo da solicitaÃ§Ã£o excede 384 bytes.");
    case BODY_JSON_REQUIRED:
        return send_error(req, 400, "JSON_REQUIRED", "Envie os dados com o tipo application/json.");
    case BODY_INCOMPLETE:
        return send_error(req, 400, "BODY_INCOMPLETE", "A solicitaÃ§Ã£o nÃ£o chegou completa. Tente novamente.");
    case BODY_TIMEOUT:
        return send_error(req, 408, "BODY_TIMEOUT", "O prazo para receber a solicitaÃ§Ã£o terminou. Tente novamente.");
    case BODY_SOCKET_ERROR:
        return send_error(req, 500, "RECEIVE_ERROR", "NÃ£o foi possÃ­vel preparar o recebimento da solicitaÃ§Ã£o.");
    case BODY_INVALID:
        return send_error(req, 400, "INVALID_JSON", "Envie um objeto JSON simples, com nÃºmeros inteiros nos campos numÃ©ricos.");
    case BODY_OK:
        break;
    }

    if (route == ROUTE_WORLD_ACTION) {
        static const char *const fields[] = {"boot", "epoch", "seq", "op", "arg"};
        const char *boot = json_string(body, "boot");
        const char *name = json_string(body, "op");
        uint32_t epoch = 0u, seq = 0u, arg = 0u;
        world_op_t op;
        world_result_t result = WORLD_INVALID_ARGUMENT;
        if (exact_fields(body, fields, 5u) && game_boot_is_valid(boot) &&
            json_uint32(body, "epoch", 1u, UINT32_MAX, &epoch) &&
            json_uint32(body, "seq", 1u, GAME_MAX_SEQUENCE, &seq) &&
            json_uint32(body, "arg", 0u, UINT32_MAX, &arg) && world_op_from_string(name, &op)) {
            result = world_apply(&s_world, identity.role, identity.student_id, boot, epoch, seq,
                                  op, arg, (uint32_t)(esp_timer_get_time() / INT64_C(1000)));
        }
        cJSON_Delete(body);
        return result == WORLD_OK ? send_session(req, &identity) : send_world_error(req, result);
    }
    game_result_t result = GAME_INVALID_ARGUMENT;
    if (route == ROUTE_JOIN) {
        if (exact_fields(body, NULL, 0u)) {
            /* Reserve the world-side change before mutating legacy presence.
             * Both cores remain unchanged if either revision is exhausted. */
            if (!s_world.players[identity.student_id - 1u].joined &&
                s_world.revision == UINT32_MAX) {
                cJSON_Delete(body);
                return send_world_error(req, WORLD_COUNTER_LIMIT);
            }
            result = game_join(&s_game, identity.student_id);
            if (result == GAME_OK) {
                const world_result_t joined = world_join(&s_world, identity.student_id);
                if (joined != WORLD_OK) { cJSON_Delete(body); return send_world_error(req, joined); }
            }
        }
    } else if (route == ROUTE_VOTE) {
        static const char *const fields[] = {"boot", "round", "choice", "seq"};
        const char *const boot = json_string(body, "boot");
        uint32_t round = 0u;
        uint32_t choice = 0u;
        uint32_t seq = 0u;
        if (exact_fields(body, fields, 4u) && game_boot_is_valid(boot) &&
            json_uint32(body, "round", 1u, UINT32_MAX, &round) &&
            json_uint32(body, "choice", 0u, GAME_CHOICE_COUNT - 1u, &choice) &&
            json_uint32(body, "seq", 1u, GAME_MAX_SEQUENCE, &seq)) {
            result = game_vote(&s_game, identity.student_id, boot, round, (int)choice, seq);
        }
    } else if (route == ROUTE_CONTROL) {
        static const char *const fields[] = {"boot", "round", "action"};
        const char *const boot = json_string(body, "boot");
        const char *const action_name = json_string(body, "action");
        uint32_t round = 0u;
        game_action_t action;
        if (exact_fields(body, fields, 3u) && game_boot_is_valid(boot) &&
            json_uint32(body, "round", 1u, UINT32_MAX, &round) &&
            game_action_from_string(action_name, &action)) {
            result = game_control(&s_game, boot, round, action);
        }
    }
    cJSON_Delete(body);
    return result == GAME_OK ? send_snapshot(req, &identity) : send_game_error(req, result);
}

static esp_err_t state_handler(httpd_req_t *req) { return api_request(req, ROUTE_STATE); }
static esp_err_t join_handler(httpd_req_t *req) { return api_request(req, ROUTE_JOIN); }
static esp_err_t vote_handler(httpd_req_t *req) { return api_request(req, ROUTE_VOTE); }
static esp_err_t control_handler(httpd_req_t *req) { return api_request(req, ROUTE_CONTROL); }
static esp_err_t health_handler(httpd_req_t *req) { return api_request(req, ROUTE_HEALTH); }
static esp_err_t session_handler(httpd_req_t *req) { return api_request(req, ROUTE_SESSION); }
static esp_err_t world_handler(httpd_req_t *req) { return api_request(req, ROUTE_WORLD); }
static esp_err_t world_action_handler(httpd_req_t *req) { return api_request(req, ROUTE_WORLD_ACTION); }

static esp_err_t avatar_manifest_handler(httpd_req_t *req)
{
    ++s_requests;
    if (req->content_len != 0u) return send_error(req, 400, "UNEXPECTED_BODY", "Consulta sem corpo.");
    return send_bytes(req, 200, "application/json; charset=utf-8", "no-cache",
                       CONEXA_AVATAR_MANIFEST, CONEXA_AVATAR_MANIFEST_LEN);
}

static esp_err_t avatar_image_handler(httpd_req_t *req)
{
    ++s_requests;
    if (req->content_len != 0u) return send_error(req, 400, "UNEXPECTED_BODY", "Consulta sem corpo.");
    if (CONEXA_AVATAR_ATLAS_LEN == 0u) return send_error(req, 404, "NO_AVATARS", "Cartoons ainda nÃ£o fornecidos.");
    (void)httpd_resp_set_hdr(req, "ETag", CONEXA_AVATAR_ETAG);
    return send_bytes(req, 200, CONEXA_AVATAR_MIME, "public, max-age=0, must-revalidate",
                       (const char *)CONEXA_AVATAR_ATLAS, CONEXA_AVATAR_ATLAS_LEN);
}

static esp_err_t page_handler(httpd_req_t *req)
{
    ++s_requests;
    if (req->content_len != 0u) {
        return send_error(req, 400, "UNEXPECTED_BODY", "Esta pÃ¡gina nÃ£o recebe um corpo de dados.");
    }
    (void)httpd_resp_set_hdr(req, "ETag", CONEXA_WEB_ETAG);
    (void)httpd_resp_set_hdr(req, "Content-Encoding", "gzip");
    (void)httpd_resp_set_hdr(req, "Vary", "Accept-Encoding");
    (void)httpd_resp_set_hdr(req, "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
        "connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    char previous_etag[128];
    if (httpd_req_get_hdr_value_len(req, "If-None-Match") < sizeof(previous_etag) &&
        httpd_req_get_hdr_value_str(req, "If-None-Match", previous_etag, sizeof(previous_etag)) == ESP_OK &&
        strcmp(previous_etag, CONEXA_WEB_ETAG) == 0) {
        return send_bytes(req, 304, "text/html; charset=utf-8", "public, max-age=0, must-revalidate", "", 0u);
    }
    return send_bytes(req, 200, "text/html; charset=utf-8", "public, max-age=0, must-revalidate",
                      (const char *)CONEXA_WEB_GZIP, (size_t)CONEXA_WEB_GZIP_LEN);
}

static esp_err_t protocol_error_handler(httpd_req_t *req, httpd_err_code_t error)
{
    ++s_requests;
    switch (error) {
    case HTTPD_404_NOT_FOUND:
        return send_error(req, 404, "NOT_FOUND", "O endereÃ§o solicitado nÃ£o existe.");
    case HTTPD_405_METHOD_NOT_ALLOWED:
        return send_error(req, 405, "METHOD_NOT_ALLOWED", "Este endereÃ§o nÃ£o aceita esse mÃ©todo.");
    case HTTPD_408_REQ_TIMEOUT:
        return send_error(req, 408, "REQUEST_TIMEOUT", "O tempo para receber a solicitaÃ§Ã£o terminou.");
    case HTTPD_411_LENGTH_REQUIRED:
        return send_error(req, 411, "LENGTH_REQUIRED", "Informe o tamanho do corpo da solicitaÃ§Ã£o.");
    case HTTPD_413_CONTENT_TOO_LARGE:
        return send_error(req, 413, "BODY_TOO_LARGE", "O corpo da solicitaÃ§Ã£o Ã© muito grande.");
    case HTTPD_414_URI_TOO_LONG:
        return send_error(req, 414, "URI_TOO_LONG", "O endereÃ§o solicitado Ã© muito longo.");
    case HTTPD_431_REQ_HDR_FIELDS_TOO_LARGE:
        return send_error(req, 431, "HEADERS_TOO_LARGE", "Os cabeÃ§alhos da solicitaÃ§Ã£o sÃ£o muito grandes.");
    case HTTPD_400_BAD_REQUEST:
        return send_error(req, 400, "BAD_REQUEST", "A solicitaÃ§Ã£o HTTP estÃ¡ em formato invÃ¡lido.");
    default:
        return send_error(req, 500, "HTTP_ERROR", "NÃ£o foi possÃ­vel processar a solicitaÃ§Ã£o HTTP.");
    }
}

static void start_http_server(void)
{
    /* Every response intentionally closes through the documented handler
     * result. Suppress the generic warning for that normal close path only. */
    esp_log_level_set("httpd_uri", ESP_LOG_ERROR);
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.server_port = 80;
    config.stack_size = 8192;
    config.max_open_sockets = 4;
    config.backlog_conn = 4;
    config.max_uri_handlers = 13;
    config.max_resp_headers = 10;
    config.recv_wait_timeout = 3;
    config.send_wait_timeout = 3;
    config.lru_purge_enable = true;
    config.keep_alive_enable = false;
    ESP_ERROR_CHECK(httpd_start(&s_httpd, &config));
    const httpd_uri_t routes[] = {
        {.uri = "/", .method = HTTP_GET, .handler = page_handler},
        {.uri = "/professor", .method = HTTP_GET, .handler = page_handler},
        {.uri = "/projetor", .method = HTTP_GET, .handler = page_handler},
        {.uri = "/api/state", .method = HTTP_GET, .handler = state_handler},
        {.uri = "/api/join", .method = HTTP_POST, .handler = join_handler},
        {.uri = "/api/vote", .method = HTTP_POST, .handler = vote_handler},
        {.uri = "/api/control", .method = HTTP_POST, .handler = control_handler},
        {.uri = "/api/health", .method = HTTP_GET, .handler = health_handler},
        {.uri = "/api/session", .method = HTTP_GET, .handler = session_handler},
        {.uri = "/api/world", .method = HTTP_GET, .handler = world_handler},
        {.uri = "/api/world/action", .method = HTTP_POST, .handler = world_action_handler},
        {.uri = "/api/avatars", .method = HTTP_GET, .handler = avatar_manifest_handler},
        {.uri = "/avatars.webp", .method = HTTP_GET, .handler = avatar_image_handler}
    };
    for (size_t i = 0; i < sizeof(routes) / sizeof(routes[0]); ++i) {
        ESP_ERROR_CHECK(httpd_register_uri_handler(s_httpd, &routes[i]));
    }
    static const httpd_err_code_t errors[] = {
        HTTPD_400_BAD_REQUEST, HTTPD_404_NOT_FOUND, HTTPD_405_METHOD_NOT_ALLOWED,
        HTTPD_408_REQ_TIMEOUT, HTTPD_411_LENGTH_REQUIRED, HTTPD_413_CONTENT_TOO_LARGE,
        HTTPD_414_URI_TOO_LONG, HTTPD_431_REQ_HDR_FIELDS_TOO_LARGE
    };
    for (size_t i = 0; i < sizeof(errors) / sizeof(errors[0]); ++i) {
        ESP_ERROR_CHECK(httpd_register_err_handler(s_httpd, errors[i], protocol_error_handler));
    }
}

static bool valid_config_token(const char *token)
{
    if (token == NULL) {
        return false;
    }
    const size_t length = strlen(token);
    if (length == 0u || length > MAX_TOKEN_BYTES) {
        return false;
    }
    for (size_t i = 0; i < length; ++i) {
        const unsigned char c = (unsigned char)token[i];
        if (c < 33u || c > 126u) {
            return false;
        }
    }
    return true;
}

static bool board_config_is_valid(void)
{
    const size_t ssid_len = strlen(CONEXA_WIFI_SSID);
    const size_t password_len = strlen(CONEXA_WIFI_PASSWORD);
    if (ssid_len == 0u || ssid_len > 32u || password_len > 64u ||
        (password_len != 0u && password_len < 8u) || !valid_config_token(CONEXA_ADMIN_TOKEN)) {
        return false;
    }
    if (password_len == 64u) {
        for (size_t i = 0; i < password_len; ++i) {
            const char c = CONEXA_WIFI_PASSWORD[i];
            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') ||
                  (c >= 'A' && c <= 'F'))) {
                return false;
            }
        }
    }
    for (unsigned i = 0; i < GAME_PLAYER_COUNT; ++i) {
        if (!valid_config_token(CONEXA_STUDENT_TOKENS[i]) ||
            strcmp(CONEXA_STUDENT_TOKENS[i], CONEXA_ADMIN_TOKEN) == 0) {
            return false;
        }
        for (unsigned j = 0; j < i; ++j) {
            if (strcmp(CONEXA_STUDENT_TOKENS[i], CONEXA_STUDENT_TOKENS[j]) == 0) {
                return false;
            }
        }
    }
    return true;
}

static void wifi_event_handler(void *arg, esp_event_base_t event_base,
                                int32_t event_id, void *event_data)
{
    (void)arg;
    if (event_base == WIFI_EVENT &&
        (event_id == WIFI_EVENT_STA_START || event_id == WIFI_EVENT_STA_DISCONNECTED)) {
        /* Wi-Fi recovery leaves the RAM game intact; never requires a PC. */
        const esp_err_t result = esp_wifi_connect();
        if (result != ESP_OK) {
            ESP_LOGW(TAG, "NÃ£o foi possÃ­vel iniciar a conexÃ£o Wi-Fi (%d).", (int)result);
        }
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        const ip_event_got_ip_t *event = (const ip_event_got_ip_t *)event_data;
        ESP_LOGI(TAG, "Servidor local: http://" IPSTR, IP2STR(&event->ip_info.ip));
    }
}

void app_main(void)
{
    if (!board_config_is_valid()) {
        ESP_LOGE(TAG, "ConfiguraÃ§Ã£o local invÃ¡lida. Execute o assistente de preparaÃ§Ã£o.");
        return;
    }
    esp_err_t result = nvs_flash_init();
    if (result == ESP_ERR_NVS_NO_FREE_PAGES || result == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        result = nvs_flash_init();
    }
    ESP_ERROR_CHECK(result);
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    s_station_netif = esp_netif_create_default_wifi_sta();
    ESP_ERROR_CHECK(s_station_netif == NULL ? ESP_ERR_NO_MEM : ESP_OK);
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event_handler, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event_handler, NULL));

    wifi_init_config_t initialization = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&initialization));
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
    wifi_config_t wifi = {0};
    memcpy(wifi.sta.ssid, CONEXA_WIFI_SSID, strlen(CONEXA_WIFI_SSID));
    memcpy(wifi.sta.password, CONEXA_WIFI_PASSWORD, strlen(CONEXA_WIFI_PASSWORD));
    wifi.sta.threshold.authmode = strlen(CONEXA_WIFI_PASSWORD) == 0u
                                  ? WIFI_AUTH_OPEN : WIFI_AUTH_WPA2_PSK;
    wifi.sta.pmf_cfg.capable = true;
    wifi.sta.pmf_cfg.required = false;
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi));
    ESP_ERROR_CHECK(esp_wifi_start());
    ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));

    /* Enable the radio before using its entropy source for this boot ID. */
    uint8_t boot_bytes[GAME_BOOT_LENGTH / 2u];
    char boot[GAME_BOOT_LENGTH + 1u];
    static const char HEX[] = "0123456789abcdef";
    esp_fill_random(boot_bytes, sizeof(boot_bytes));
    for (size_t i = 0; i < sizeof(boot_bytes); ++i) {
        boot[i * 2u] = HEX[boot_bytes[i] >> 4u];
        boot[i * 2u + 1u] = HEX[boot_bytes[i] & 0x0fu];
    }
    boot[GAME_BOOT_LENGTH] = '\0';
    ESP_ERROR_CHECK(game_init(&s_game, boot) == GAME_OK ? ESP_OK : ESP_FAIL);
    ESP_ERROR_CHECK(world_init(&s_world, boot) == WORLD_OK ? ESP_OK : ESP_FAIL);
    start_http_server();
    ESP_LOGI(TAG, "CONEXA %s: servidor na placa, partida em RAM, sem backend auxiliar.", CONEXA_VERSION);
}
