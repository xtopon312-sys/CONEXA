#include "game_core.h"

#include <inttypes.h>
#include <stdio.h>
#include <string.h>

static bool valid_student(unsigned student_id)
{
    return student_id >= 1u && student_id <= GAME_PLAYER_COUNT;
}

bool game_boot_is_valid(const char *boot)
{
    if (boot == NULL) {
        return false;
    }
    for (size_t i = 0; i < GAME_BOOT_LENGTH; ++i) {
        const unsigned char c = (unsigned char)boot[i];
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') ||
              (c >= 'A' && c <= 'F'))) {
            return false;
        }
    }
    return boot[GAME_BOOT_LENGTH] == '\0';
}

game_result_t game_init(game_state_t *game, const char *boot)
{
    if (game == NULL || !game_boot_is_valid(boot)) {
        return GAME_INVALID_ARGUMENT;
    }
    /* Copy before clearing so game_init(&g, g.boot) is also well defined. */
    char new_boot[GAME_BOOT_LENGTH + 1u];
    memcpy(new_boot, boot, sizeof(new_boot));
    memset(game, 0, sizeof(*game));
    memcpy(game->boot, new_boot, sizeof(new_boot));
    game->round = 1u;
    game->revision = 1u;
    game->phase = GAME_PHASE_LOBBY;
    for (size_t i = 0; i < GAME_PLAYER_COUNT; ++i) {
        game->players[i].choice = -1;
    }
    return GAME_OK;
}

game_result_t game_join(game_state_t *game, unsigned student_id)
{
    if (game == NULL || !valid_student(student_id)) {
        return GAME_INVALID_ARGUMENT;
    }
    game_player_t *player = &game->players[student_id - 1u];
    if (player->joined) {
        return GAME_OK;
    }
    if (game->revision == UINT32_MAX) {
        return GAME_COUNTER_LIMIT;
    }
    player->joined = true;
    ++game->participants;
    ++game->revision;
    return GAME_OK;
}

game_result_t game_vote(game_state_t *game, unsigned student_id,
                        const char *boot, uint32_t round,
                        int choice, uint32_t seq)
{
    if (game == NULL || !valid_student(student_id) ||
        !game_boot_is_valid(boot) || round == 0u ||
        choice < 0 || choice >= (int)GAME_CHOICE_COUNT ||
        seq == 0u || seq > GAME_MAX_SEQUENCE) {
        return GAME_INVALID_ARGUMENT;
    }
    if (strcmp(game->boot, boot) != 0 || game->round != round) {
        return GAME_ROUND_CONFLICT;
    }
    game_player_t *player = &game->players[student_id - 1u];
    if (!player->joined) {
        return GAME_NOT_JOINED;
    }
    /* A retry confirms an already applied action, even after pause/close. */
    if (seq == player->last_seq) {
        return player->choice == choice ? GAME_OK : GAME_SEQUENCE_CONFLICT;
    }
    if (seq != player->last_seq + 1u) {
        return GAME_SEQUENCE_CONFLICT;
    }
    if (game->phase != GAME_PHASE_OPEN) {
        return GAME_PHASE_CONFLICT;
    }
    if (game->revision == UINT32_MAX) {
        return GAME_COUNTER_LIMIT;
    }

    /* Every validation above precedes every mutation below. */
    if (player->choice < 0) {
        ++game->answer_count;
    } else {
        --game->totals[(unsigned)player->choice];
    }
    ++game->totals[(unsigned)choice];
    player->choice = (int8_t)choice;
    player->last_seq = seq;
    ++game->revision;
    return GAME_OK;
}

game_result_t game_control(game_state_t *game, const char *boot,
                           uint32_t round, game_action_t action)
{
    if (game == NULL || !game_boot_is_valid(boot) || round == 0u ||
        action < GAME_ACTION_OPEN || action > GAME_ACTION_RESET) {
        return GAME_INVALID_ARGUMENT;
    }
    if (strcmp(game->boot, boot) != 0 || game->round != round) {
        return GAME_ROUND_CONFLICT;
    }

    game_phase_t next_phase = game->phase;
    switch (action) {
    case GAME_ACTION_OPEN:
        if (game->phase != GAME_PHASE_LOBBY && game->phase != GAME_PHASE_OPEN) {
            return GAME_PHASE_CONFLICT;
        }
        next_phase = GAME_PHASE_OPEN;
        break;
    case GAME_ACTION_PAUSE:
        if (game->phase != GAME_PHASE_OPEN && game->phase != GAME_PHASE_PAUSED) {
            return GAME_PHASE_CONFLICT;
        }
        next_phase = GAME_PHASE_PAUSED;
        break;
    case GAME_ACTION_RESUME:
        if (game->phase != GAME_PHASE_PAUSED && game->phase != GAME_PHASE_OPEN) {
            return GAME_PHASE_CONFLICT;
        }
        next_phase = GAME_PHASE_OPEN;
        break;
    case GAME_ACTION_CLOSE:
        if (game->phase != GAME_PHASE_OPEN && game->phase != GAME_PHASE_PAUSED &&
            game->phase != GAME_PHASE_CLOSED) {
            return GAME_PHASE_CONFLICT;
        }
        next_phase = GAME_PHASE_CLOSED;
        break;
    case GAME_ACTION_RESET:
        if (game->round == UINT32_MAX || game->revision == UINT32_MAX) {
            return GAME_COUNTER_LIMIT;
        }
        for (size_t i = 0; i < GAME_PLAYER_COUNT; ++i) {
            game->players[i].choice = -1;
            game->players[i].last_seq = 0u;
        }
        memset(game->totals, 0, sizeof(game->totals));
        game->answer_count = 0u;
        game->phase = GAME_PHASE_LOBBY;
        ++game->round;
        ++game->revision;
        return GAME_OK;
    }
    if (next_phase == game->phase) {
        return GAME_OK;
    }
    if (game->revision == UINT32_MAX) {
        return GAME_COUNTER_LIMIT;
    }
    game->phase = next_phase;
    ++game->revision;
    return GAME_OK;
}

const char *game_phase_name(game_phase_t phase)
{
    switch (phase) {
    case GAME_PHASE_LOBBY: return "lobby";
    case GAME_PHASE_OPEN: return "open";
    case GAME_PHASE_PAUSED: return "paused";
    case GAME_PHASE_CLOSED: return "closed";
    }
    return "invalid";
}

bool game_action_from_string(const char *text, game_action_t *action)
{
    static const char *const names[] = {"open", "pause", "resume", "close", "reset"};
    if (text == NULL || action == NULL) {
        return false;
    }
    for (unsigned i = 0; i < sizeof(names) / sizeof(names[0]); ++i) {
        if (strcmp(text, names[i]) == 0) {
            *action = (game_action_t)i;
            return true;
        }
    }
    return false;
}

size_t game_snapshot_json(const game_state_t *game, game_role_t role,
                          unsigned student_id, char *buffer, size_t capacity)
{
    if (game == NULL || buffer == NULL || capacity == 0u ||
        role < GAME_ROLE_VISITOR || role > GAME_ROLE_TEACHER ||
        (role == GAME_ROLE_STUDENT && !valid_student(student_id))) {
        return 0u;
    }
    char joined[GAME_PLAYER_COUNT + 1u];
    char voted[GAME_PLAYER_COUNT + 1u];
    for (size_t i = 0; i < GAME_PLAYER_COUNT; ++i) {
        joined[i] = game->players[i].joined ? '1' : '0';
        voted[i] = game->players[i].choice >= 0 ? '1' : '0';
    }
    joined[GAME_PLAYER_COUNT] = '\0';
    voted[GAME_PLAYER_COUNT] = '\0';

    char totals[32] = "null";
    if (game->phase == GAME_PHASE_CLOSED) {
        (void)snprintf(totals, sizeof(totals), "[%u,%u,%u]",
                       (unsigned)game->totals[0], (unsigned)game->totals[1],
                       (unsigned)game->totals[2]);
    }
    char me[128] = "null";
    const char *role_name = "visitor";
    if (role == GAME_ROLE_STUDENT) {
        const game_player_t *player = &game->players[student_id - 1u];
        role_name = "student";
        (void)snprintf(me, sizeof(me),
                       "{\"id\":%u,\"joined\":%s,\"choice\":%d,\"last_seq\":%" PRIu32 "}",
                       student_id, player->joined ? "true" : "false",
                       (int)player->choice, player->last_seq);
    } else if (role == GAME_ROLE_TEACHER) {
        role_name = "teacher";
    }

    const int written = snprintf(buffer, capacity,
        "{\"protocol\":1,\"boot\":\"%s\",\"round\":%" PRIu32 ","
        "\"revision\":%" PRIu32 ",\"phase\":\"%s\",\"role\":\"%s\","
        "\"joined\":\"%s\",\"voted\":\"%s\",\"participants\":%u,"
        "\"answer_count\":%u,\"totals\":%s,\"me\":%s}",
        game->boot, game->round, game->revision, game_phase_name(game->phase),
        role_name, joined, voted, (unsigned)game->participants,
        (unsigned)game->answer_count, totals, me);
    if (written < 0 || (size_t)written >= capacity) {
        buffer[0] = '\0';
        return 0u;
    }
    return (size_t)written;
}
