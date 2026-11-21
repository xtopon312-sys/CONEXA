#include "world_core.h"

#include <inttypes.h>
#include <stdio.h>
#include <string.h>

static bool valid_id(unsigned id) { return id >= 1u && id <= GAME_PLAYER_COUNT; }
static bool valid_role(game_role_t role)
{
    return role >= GAME_ROLE_VISITOR && role <= GAME_ROLE_TEACHER;
}

bool world_walkable(int x, int y)
{
    static const int trees[8][2] = {
        {1,9},{2,11},{3,12},{11,11},{12,9},{7,1},{10,1},{13,1}
    };
    if (x < 0 || y < 0 || x >= (int)WORLD_SIZE || y >= (int)WORLD_SIZE ||
        (x >= 1 && x <= 4 && y >= 2 && y <= 4) ||
        (x >= 10 && x <= 11 && y >= 2 && y <= 3) ||
        (x >= 7 && x <= 8 && y >= 7 && y <= 8) ||
        (x == 5 && (y == 6 || y == 12)) || (x == 10 && y == 11) ||
        (x <= 1 && y >= 7 && y <= 8) || (x >= 12 && y >= 11 && y <= 12)) {
        return false;
    }
    for (size_t i = 0; i < 8u; ++i) {
        if (trees[i][0] == x && trees[i][1] == y) return false;
    }
    return true;
}

int world_path_distance(int from_x, int from_y, int to_x, int to_y)
{
    if (!world_walkable(from_x, from_y) || !world_walkable(to_x, to_y)) return -1;
    uint8_t queue[WORLD_SIZE * WORLD_SIZE];
    int16_t distances[WORLD_SIZE * WORLD_SIZE];
    static const int delta[4][2] = {{1,0},{0,1},{-1,0},{0,-1}};
    for (size_t i = 0; i < WORLD_SIZE * WORLD_SIZE; ++i) distances[i] = -1;
    size_t head = 0u, tail = 0u;
    unsigned start = (unsigned)from_y * WORLD_SIZE + (unsigned)from_x;
    queue[tail++] = (uint8_t)start;
    distances[start] = 0;
    while (head < tail) {
        unsigned current = queue[head++];
        int x = (int)(current % WORLD_SIZE), y = (int)(current / WORLD_SIZE);
        if (x == to_x && y == to_y) return distances[current];
        for (size_t i = 0; i < 4u; ++i) {
            int nx = x + delta[i][0], ny = y + delta[i][1];
            if (!world_walkable(nx, ny)) continue;
            unsigned next = (unsigned)ny * WORLD_SIZE + (unsigned)nx;
            if (distances[next] >= 0) continue;
            distances[next] = (int16_t)(distances[current] + 1);
            queue[tail++] = (uint8_t)next;
        }
    }
    return -1;
}

static void reset_player(world_player_t *player, bool joined, unsigned index)
{
    static const uint8_t spawn[GAME_PLAYER_COUNT][2] = {
        {13,0},{0,13},{6,1},{13,10},{0,6},{13,5},{7,9},{5,4},{1,10},{9,0},
        {2,5},{11,6},{9,13},{4,9},{11,12},{8,5},{10,9},{11,0},{9,2},{2,13},
        {4,13},{13,3},{5,2},{4,5},{2,9},{7,3},{3,7},{13,7},{5,8},{12,8},
        {6,10},{3,11},{5,11},{8,11},{7,12},{7,0},{9,4},{11,4},{10,7},{9,10},
        {0,11},{6,0},{8,0},{10,0}
    };
    memset(player, 0, sizeof(*player));
    player->joined = joined;
    player->x = spawn[index][0];
    player->y = spawn[index][1];
    player->movement_credit_ms = (uint16_t)(4u * WORLD_TILE_TIME_MS);
    for (size_t i = 0; i < WORLD_MISSION_COUNT; ++i) player->decisions[i] = -1;
}

world_result_t world_init(world_state_t *world, const char *boot)
{
    if (world == NULL || !game_boot_is_valid(boot)) return WORLD_INVALID_ARGUMENT;
    char copy[GAME_BOOT_LENGTH + 1u];
    memcpy(copy, boot, sizeof(copy));
    memset(world, 0, sizeof(*world));
    memcpy(world->boot, copy, sizeof(copy));
    world->epoch = 1u;
    world->revision = 1u;
    world->phase = GAME_PHASE_LOBBY;
    for (unsigned i = 0; i < GAME_PLAYER_COUNT; ++i) reset_player(&world->players[i], false, i);
    return WORLD_OK;
}

world_result_t world_join(world_state_t *world, unsigned student_id)
{
    if (world == NULL || !valid_id(student_id)) return WORLD_INVALID_ARGUMENT;
    world_player_t *player = &world->players[student_id - 1u];
    if (player->joined) return WORLD_OK;
    if (world->revision == UINT32_MAX) return WORLD_COUNTER_LIMIT;
    player->joined = true;
    ++world->revision;
    return WORLD_OK;
}

const char *world_op_name(world_op_t op)
{
    static const char *const names[] = {
        "move", "inspect", "resolve", "start", "pause", "resume",
        "release", "next", "finish", "reset"
    };
    return op >= WORLD_OP_MOVE && op <= WORLD_OP_RESET ? names[(unsigned)op] : NULL;
}

bool world_op_from_string(const char *text, world_op_t *op)
{
    if (text == NULL || op == NULL) return false;
    for (unsigned i = 0; i <= (unsigned)WORLD_OP_RESET; ++i) {
        if (strcmp(text, world_op_name((world_op_t)i)) == 0) { *op = (world_op_t)i; return true; }
    }
    return false;
}

const char *world_result_name(world_result_t result)
{
    static const char *const names[] = {
        "ok", "invalid_argument", "forbidden", "not_joined", "session_conflict",
        "phase_conflict", "sequence_conflict", "counter_limit", "collision",
        "rate_limit", "too_far", "evidence_required", "not_released", "already_completed"
    };
    return result >= WORLD_OK && result <= WORLD_ALREADY_COMPLETED ? names[(unsigned)result] : "unknown";
}

static bool nearby(const world_player_t *player, unsigned clue)
{
    static const int locations[WORLD_CLUE_COUNT][2] = {{10,4},{5,5},{6,10},{12,6}};
    int dx = (int)player->x - locations[clue][0];
    int dy = (int)player->y - locations[clue][1];
    if (dx < 0) dx = -dx;
    if (dy < 0) dy = -dy;
    return dx + dy <= 1;
}

static world_result_t student_apply(world_state_t *world, world_player_t *player,
                                    world_op_t op, uint32_t arg, uint32_t now_ms)
{
    if (world->phase != GAME_PHASE_OPEN) return WORLD_PHASE_CONFLICT;
    if (op == WORLD_OP_MOVE) {
        if (arg >= WORLD_SIZE * WORLD_SIZE) return WORLD_INVALID_ARGUMENT;
        int x = (int)(arg % WORLD_SIZE), y = (int)(arg / WORLD_SIZE);
        int distance = world_path_distance(player->x, player->y, x, y);
        if (distance < 0) return WORLD_COLLISION;
        if (distance == 0) return WORLD_INVALID_ARGUMENT;
        if (distance > (int)WORLD_MAX_MOVE_TILES) return WORLD_TOO_FAR;
        uint32_t elapsed = player->has_moved ? now_ms - player->last_move_ms : 0u;
        if (player->has_moved && elapsed < WORLD_MOVE_INTERVAL_MS) return WORLD_RATE_LIMIT;
        uint32_t credit = player->movement_credit_ms;
        if (elapsed >= WORLD_MAX_MOVE_TILES * WORLD_TILE_TIME_MS) {
            credit = WORLD_MAX_MOVE_TILES * WORLD_TILE_TIME_MS;
        } else {
            credit += elapsed;
            if (credit > WORLD_MAX_MOVE_TILES * WORLD_TILE_TIME_MS) credit = WORLD_MAX_MOVE_TILES * WORLD_TILE_TIME_MS;
        }
        uint32_t cost = (uint32_t)distance * WORLD_TILE_TIME_MS;
        if (cost > credit) return WORLD_RATE_LIMIT;
        player->x = (uint8_t)x;
        player->y = (uint8_t)y;
        player->movement_credit_ms = (uint16_t)(credit - cost);
        player->last_move_ms = now_ms;
        player->has_moved = true;
        return WORLD_OK;
    }
    if (op == WORLD_OP_INSPECT) {
        unsigned mission = (unsigned)(arg / 8u), clue = (unsigned)(arg % 8u);
        if (mission >= WORLD_MISSION_COUNT || clue >= WORLD_CLUE_COUNT) return WORLD_INVALID_ARGUMENT;
        if (mission > world->mission) return WORLD_PHASE_CONFLICT;
        if (clue == 3u && !(world->released & (1u << mission))) return WORLD_NOT_RELEASED;
        if (!nearby(player, clue)) return WORLD_TOO_FAR;
        player->clues[mission] |= (uint8_t)(1u << clue);
        return WORLD_OK;
    }
    if (op == WORLD_OP_RESOLVE) {
        static const unsigned links[WORLD_MISSION_COUNT] = {201u,114u,141u};
        unsigned mission = (unsigned)(arg / 4096u);
        unsigned choice = (unsigned)((arg % 4096u) / 256u);
        unsigned evidence = (unsigned)(arg % 256u);
        if (mission >= WORLD_MISSION_COUNT || choice >= GAME_CHOICE_COUNT) return WORLD_INVALID_ARGUMENT;
        if (mission > world->mission) return WORLD_PHASE_CONFLICT;
        if (player->done & (1u << mission)) return WORLD_ALREADY_COMPLETED;
        if (!nearby(player, 0u)) return WORLD_TOO_FAR;
        if (player->clues[mission] != 15u || evidence != links[mission]) return WORLD_EVIDENCE_REQUIRED;
        player->decisions[mission] = (int8_t)choice;
        player->done |= (uint8_t)(1u << mission);
        return WORLD_OK;
    }
    return WORLD_FORBIDDEN;
}

static world_result_t teacher_apply(world_state_t *world, world_op_t op, uint32_t seq)
{
    switch (op) {
    case WORLD_OP_START:
        if (world->phase != GAME_PHASE_LOBBY) return WORLD_PHASE_CONFLICT;
        world->phase = GAME_PHASE_OPEN;
        break;
    case WORLD_OP_PAUSE:
        if (world->phase != GAME_PHASE_OPEN) return WORLD_PHASE_CONFLICT;
        world->phase = GAME_PHASE_PAUSED;
        break;
    case WORLD_OP_RESUME:
        if (world->phase != GAME_PHASE_PAUSED) return WORLD_PHASE_CONFLICT;
        world->phase = GAME_PHASE_OPEN;
        break;
    case WORLD_OP_RELEASE:
        if (world->phase != GAME_PHASE_OPEN) return WORLD_PHASE_CONFLICT;
        world->released |= (uint8_t)(1u << world->mission);
        break;
    case WORLD_OP_NEXT:
        if (world->phase != GAME_PHASE_OPEN || world->mission + 1u >= WORLD_MISSION_COUNT) return WORLD_PHASE_CONFLICT;
        if (!(world->released & (1u << world->mission))) return WORLD_NOT_RELEASED;
        ++world->mission;
        break;
    case WORLD_OP_FINISH:
        if (world->phase != GAME_PHASE_OPEN && world->phase != GAME_PHASE_PAUSED) return WORLD_PHASE_CONFLICT;
        world->phase = GAME_PHASE_CLOSED;
        break;
    case WORLD_OP_RESET:
        if (world->epoch == UINT32_MAX) return WORLD_COUNTER_LIMIT;
        world->has_reset_receipt = true;
        world->reset_epoch = world->epoch;
        world->reset_seq = seq;
        ++world->epoch;
        world->phase = GAME_PHASE_LOBBY;
        world->mission = world->released = 0u;
        world->teacher_seq = 0u;
        world->teacher_last_op = WORLD_OP_MOVE;
        world->teacher_last_arg = 0u;
        for (unsigned i = 0; i < GAME_PLAYER_COUNT; ++i) {
            reset_player(&world->players[i], world->players[i].joined, i);
        }
        break;
    default: return WORLD_FORBIDDEN;
    }
    return WORLD_OK;
}

world_result_t world_apply(world_state_t *world, game_role_t role,
                          unsigned student_id, const char *boot,
                          uint32_t epoch, uint32_t seq, world_op_t op,
                          uint32_t arg, uint32_t now_ms)
{
    if (world == NULL || !valid_role(role) || !game_boot_is_valid(boot) || epoch == 0u ||
        seq == 0u || seq > GAME_MAX_SEQUENCE || op < WORLD_OP_MOVE || op > WORLD_OP_RESET ||
        (role == GAME_ROLE_STUDENT && !valid_id(student_id))) return WORLD_INVALID_ARGUMENT;
    if (role == GAME_ROLE_VISITOR ||
        (role == GAME_ROLE_STUDENT && op > WORLD_OP_RESOLVE) ||
        (role == GAME_ROLE_TEACHER && op < WORLD_OP_START)) return WORLD_FORBIDDEN;
    if (role == GAME_ROLE_TEACHER && arg != 0u) return WORLD_INVALID_ARGUMENT;
    if (strcmp(world->boot, boot) != 0) return WORLD_SESSION_CONFLICT;
    if (role == GAME_ROLE_TEACHER && op == WORLD_OP_RESET && world->has_reset_receipt &&
        epoch == world->reset_epoch && seq == world->reset_seq) return WORLD_OK;
    if (epoch != world->epoch) return WORLD_SESSION_CONFLICT;
    world_player_t *player = role == GAME_ROLE_STUDENT ? &world->players[student_id - 1u] : NULL;
    if (player != NULL && !player->joined) return WORLD_NOT_JOINED;
    uint32_t last_seq = player != NULL ? player->seq : world->teacher_seq;
    world_op_t last_op = player != NULL ? player->last_op : world->teacher_last_op;
    uint32_t last_arg = player != NULL ? player->last_arg : world->teacher_last_arg;
    if (seq == last_seq) return op == last_op && arg == last_arg ? WORLD_OK : WORLD_SEQUENCE_CONFLICT;
    if (last_seq == GAME_MAX_SEQUENCE || seq != last_seq + 1u) return WORLD_SEQUENCE_CONFLICT;
    if (world->revision == UINT32_MAX) return WORLD_COUNTER_LIMIT;

    world_result_t result = player != NULL ? student_apply(world, player, op, arg, now_ms) : teacher_apply(world, op, seq);
    if (result != WORLD_OK) return result;
    if (player != NULL) {
        player->seq = seq;
        player->last_op = op;
        player->last_arg = arg;
    } else if (op != WORLD_OP_RESET) {
        world->teacher_seq = seq;
        world->teacher_last_op = op;
        world->teacher_last_arg = arg;
    }
    ++world->revision;
    return WORLD_OK;
}

size_t world_snapshot_json(const world_state_t *world, game_role_t role,
                           unsigned student_id, char *buffer, size_t capacity)
{
    if (world == NULL || buffer == NULL || capacity == 0u || !valid_role(role) ||
        (role == GAME_ROLE_STUDENT && !valid_id(student_id))) return 0u;
    static const char hex[] = "0123456789abcdef";
    char positions[GAME_PLAYER_COUNT * 2u + 1u];
    char progress[GAME_PLAYER_COUNT * 4u + 1u];
    unsigned completed[WORLD_MISSION_COUNT] = {0u,0u,0u};
    unsigned decisions[WORLD_MISSION_COUNT][GAME_CHOICE_COUNT] = {{0u}};
    for (size_t i = 0; i < GAME_PLAYER_COUNT; ++i) {
        const world_player_t *p = &world->players[i];
        positions[i * 2u] = p->joined ? hex[p->x] : '-';
        positions[i * 2u + 1u] = p->joined ? hex[p->y] : '-';
        for (size_t m = 0; m < WORLD_MISSION_COUNT; ++m) {
            progress[i * 4u + m] = p->joined ? hex[p->clues[m]] : '-';
            if (p->joined && (p->done & (1u << m))) {
                ++completed[m];
                if (p->decisions[m] >= 0 && p->decisions[m] < (int8_t)GAME_CHOICE_COUNT) ++decisions[m][(unsigned)p->decisions[m]];
            }
        }
        progress[i * 4u + 3u] = p->joined ? hex[p->done] : '-';
    }
    positions[GAME_PLAYER_COUNT * 2u] = '\0';
    progress[GAME_PLAYER_COUNT * 4u] = '\0';
    char counts[80] = "null";
    if (role == GAME_ROLE_TEACHER || world->phase == GAME_PHASE_CLOSED) {
        (void)snprintf(counts, sizeof(counts), "[[%u,%u,%u],[%u,%u,%u],[%u,%u,%u]]",
            decisions[0][0],decisions[0][1],decisions[0][2],decisions[1][0],decisions[1][1],decisions[1][2],decisions[2][0],decisions[2][1],decisions[2][2]);
    }
    char me[272] = "null", teacher[320] = "null";
    char receipt[72] = "\"last_op\":null,\"last_arg\":0";
    const char *role_name = "visitor";
    if (role == GAME_ROLE_STUDENT) {
        const world_player_t *p = &world->players[student_id - 1u];
        role_name = "student";
        if (p->seq > 0u) (void)snprintf(receipt, sizeof(receipt), "\"last_op\":\"%s\",\"last_arg\":%" PRIu32, world_op_name(p->last_op), p->last_arg);
        (void)snprintf(me, sizeof(me),
            "{\"id\":%u,\"joined\":%s,\"seq\":%" PRIu32 ",%s,\"x\":%u,\"y\":%u,\"clues\":[%u,%u,%u],\"done\":%u,\"decisions\":[%d,%d,%d]}",
            student_id,p->joined?"true":"false",p->seq,receipt,(unsigned)p->x,(unsigned)p->y,
            (unsigned)p->clues[0],(unsigned)p->clues[1],(unsigned)p->clues[2],(unsigned)p->done,
            (int)p->decisions[0],(int)p->decisions[1],(int)p->decisions[2]);
    } else if (role == GAME_ROLE_TEACHER) {
        role_name = "teacher";
        if (world->teacher_seq > 0u) (void)snprintf(receipt, sizeof(receipt), "\"last_op\":\"%s\",\"last_arg\":%" PRIu32, world_op_name(world->teacher_last_op), world->teacher_last_arg);
        (void)snprintf(teacher, sizeof(teacher), "{\"seq\":%" PRIu32 ",%s,\"progress\":\"%s\"}", world->teacher_seq,receipt,progress);
    }
    int written = snprintf(buffer, capacity,
        "{\"v\":1,\"boot\":\"%s\",\"epoch\":%" PRIu32 ",\"rev\":%" PRIu32 ",\"role\":\"%s\",\"phase\":\"%s\",\"mission\":%u,\"released\":%u,\"positions\":\"%s\",\"completed\":[%u,%u,%u],\"decisions\":%s,\"me\":%s,\"teacher\":%s}",
        world->boot,world->epoch,world->revision,role_name,game_phase_name(world->phase),
        (unsigned)world->mission,(unsigned)world->released,positions,completed[0],completed[1],completed[2],counts,me,teacher);
    if (written < 0 || (size_t)written >= capacity) { buffer[0] = '\0'; return 0u; }
    return (size_t)written;
}
