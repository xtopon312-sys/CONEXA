#include "game_core.h"

#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char BOOT[] = "0123456789abcdef";
static const char OTHER_BOOT[] = "fedcba9876543210";
static unsigned checks;

#define CHECK(expression) do { \
    ++checks; \
    if (!(expression)) { \
        fprintf(stderr, "FAIL line %d: %s\n", __LINE__, #expression); \
        exit(EXIT_FAILURE); \
    } \
} while (0)

#define UNCHANGED(game, expression, expected) do { \
    const game_state_t before_ = (game); \
    CHECK((expression) == (expected)); \
    CHECK(memcmp(&before_, &(game), sizeof(game)) == 0); \
} while (0)

static game_state_t fresh(void)
{
    game_state_t game;
    CHECK(game_init(&game, BOOT) == GAME_OK);
    return game;
}

static game_state_t one_voter(void)
{
    game_state_t game = fresh();
    CHECK(game_join(&game, 1u) == GAME_OK);
    CHECK(game_control(&game, BOOT, 1u, GAME_ACTION_OPEN) == GAME_OK);
    CHECK(game_vote(&game, 1u, BOOT, 1u, 0, 1u) == GAME_OK);
    return game;
}

static void invariant(const game_state_t *game)
{
    unsigned participants = 0;
    unsigned answers = 0;
    unsigned totals[GAME_CHOICE_COUNT] = {0};
    for (unsigned i = 0; i < GAME_PLAYER_COUNT; ++i) {
        const game_player_t *player = &game->players[i];
        participants += player->joined ? 1u : 0u;
        CHECK(player->choice >= -1 && player->choice < (int)GAME_CHOICE_COUNT);
        CHECK(player->last_seq <= GAME_MAX_SEQUENCE);
        if (player->choice >= 0) {
            CHECK(player->joined);
            CHECK(player->last_seq > 0);
            ++answers;
            ++totals[(unsigned)player->choice];
        } else {
            CHECK(player->last_seq == 0);
        }
    }
    CHECK(participants == game->participants);
    CHECK(answers == game->answer_count);
    for (unsigned i = 0; i < GAME_CHOICE_COUNT; ++i) {
        CHECK(totals[i] == game->totals[i]);
    }
}

static void test_initialization_and_limits(void)
{
    game_state_t game = fresh();
    CHECK(game.round == 1u && game.revision == 1u);
    CHECK(game.phase == GAME_PHASE_LOBBY);
    CHECK(game.participants == 0u && game.answer_count == 0u);
    CHECK(strcmp(game.boot, BOOT) == 0);
    invariant(&game);
    CHECK(!game_boot_is_valid(NULL));
    CHECK(!game_boot_is_valid(""));
    CHECK(!game_boot_is_valid("1"));
    CHECK(!game_boot_is_valid("0123456789abcdeg"));
    CHECK(!game_boot_is_valid("0123456789abcdef0"));
    CHECK(game_boot_is_valid("0123456789ABCDEF"));
    UNCHANGED(game, game_init(&game, "bad"), GAME_INVALID_ARGUMENT);
    UNCHANGED(game, game_join(&game, 0u), GAME_INVALID_ARGUMENT);
    UNCHANGED(game, game_join(&game, 45u), GAME_INVALID_ARGUMENT);
    UNCHANGED(game, game_join(&game, UINT_MAX), GAME_INVALID_ARGUMENT);
    CHECK(game_join(&game, 1u) == GAME_OK);
    CHECK(game_join(&game, 44u) == GAME_OK);
    CHECK(game.participants == 2u && game.revision == 3u);
    UNCHANGED(game, game_join(&game, 1u), GAME_OK);
    UNCHANGED(game, game_join(&game, 44u), GAME_OK);
    CHECK(game_init(&game, game.boot) == GAME_OK);
    CHECK(game.participants == 0u && game.round == 1u);
}

static void test_invalid_votes_are_atomic(void)
{
    game_state_t game = fresh();
    UNCHANGED(game, game_vote(&game, 1u, BOOT, 1u, 0, 1u), GAME_NOT_JOINED);
    CHECK(game_join(&game, 1u) == GAME_OK);
    UNCHANGED(game, game_vote(&game, 1u, BOOT, 1u, 0, 1u), GAME_PHASE_CONFLICT);
    CHECK(game_control(&game, BOOT, 1u, GAME_ACTION_OPEN) == GAME_OK);
    UNCHANGED(game, game_vote(&game, 0u, BOOT, 1u, 0, 1u), GAME_INVALID_ARGUMENT);
    UNCHANGED(game, game_vote(&game, 45u, BOOT, 1u, 0, 1u), GAME_INVALID_ARGUMENT);
    UNCHANGED(game, game_vote(&game, 1u, NULL, 1u, 0, 1u), GAME_INVALID_ARGUMENT);
    UNCHANGED(game, game_vote(&game, 1u, BOOT, 0u, 0, 1u), GAME_INVALID_ARGUMENT);
    UNCHANGED(game, game_vote(&game, 1u, BOOT, 1u, -1, 1u), GAME_INVALID_ARGUMENT);
    UNCHANGED(game, game_vote(&game, 1u, BOOT, 1u, 3, 1u), GAME_INVALID_ARGUMENT);
    UNCHANGED(game, game_vote(&game, 1u, BOOT, 1u, INT_MAX, 1u), GAME_INVALID_ARGUMENT);
    UNCHANGED(game, game_vote(&game, 1u, BOOT, 1u, 0, 0u), GAME_INVALID_ARGUMENT);
    UNCHANGED(game, game_vote(&game, 1u, BOOT, 1u, 0, GAME_MAX_SEQUENCE + 1u), GAME_INVALID_ARGUMENT);
    UNCHANGED(game, game_vote(&game, 1u, OTHER_BOOT, 1u, 0, 1u), GAME_ROUND_CONFLICT);
    UNCHANGED(game, game_vote(&game, 1u, BOOT, 2u, 0, 1u), GAME_ROUND_CONFLICT);
    UNCHANGED(game, game_vote(&game, 1u, BOOT, 1u, 0, 2u), GAME_SEQUENCE_CONFLICT);
    invariant(&game);
}

static void test_vote_change_retry_and_reconnect(void)
{
    game_state_t game = one_voter();
    CHECK(game.answer_count == 1u && game.totals[0] == 1u);
    CHECK(game.players[0].choice == 0 && game.players[0].last_seq == 1u);
    UNCHANGED(game, game_vote(&game, 1u, BOOT, 1u, 0, 1u), GAME_OK);
    UNCHANGED(game, game_vote(&game, 1u, BOOT, 1u, 1, 1u), GAME_SEQUENCE_CONFLICT);
    UNCHANGED(game, game_vote(&game, 1u, BOOT, 1u, 1, 3u), GAME_SEQUENCE_CONFLICT);
    const uint32_t revision = game.revision;
    CHECK(game_vote(&game, 1u, BOOT, 1u, 1, 2u) == GAME_OK);
    CHECK(game.revision == revision + 1u);
    CHECK(game.answer_count == 1u && game.totals[0] == 0u && game.totals[1] == 1u);
    UNCHANGED(game, game_vote(&game, 1u, BOOT, 1u, 0, 1u), GAME_SEQUENCE_CONFLICT);
    UNCHANGED(game, game_join(&game, 1u), GAME_OK);
    CHECK(game.players[0].choice == 1 && game.players[0].last_seq == 2u);
    CHECK(game_vote(&game, 1u, BOOT, 1u, 1, 3u) == GAME_OK);
    CHECK(game.answer_count == 1u && game.totals[1] == 1u);
    CHECK(game_control(&game, BOOT, 1u, GAME_ACTION_PAUSE) == GAME_OK);
    UNCHANGED(game, game_vote(&game, 1u, BOOT, 1u, 1, 3u), GAME_OK);
    UNCHANGED(game, game_vote(&game, 1u, BOOT, 1u, 2, 4u), GAME_PHASE_CONFLICT);
    CHECK(game_control(&game, BOOT, 1u, GAME_ACTION_CLOSE) == GAME_OK);
    UNCHANGED(game, game_vote(&game, 1u, BOOT, 1u, 1, 3u), GAME_OK);
    UNCHANGED(game, game_vote(&game, 1u, BOOT, 1u, 0, 3u), GAME_SEQUENCE_CONFLICT);
    UNCHANGED(game, game_vote(&game, 1u, BOOT, 1u, 2, 4u), GAME_PHASE_CONFLICT);
    CHECK(game_join(&game, 44u) == GAME_OK);
    CHECK(game.participants == 2u && game.answer_count == 1u);
    invariant(&game);
}

static void test_complete_transition_contract(void)
{
    /* Rows: lobby/open/paused/closed. Columns: open/pause/resume/close.
     * -1 denotes a conflict; reset is checked separately for every phase. */
    static const int expected[4][4] = {
        {GAME_PHASE_OPEN, -1, -1, -1},
        {GAME_PHASE_OPEN, GAME_PHASE_PAUSED, GAME_PHASE_OPEN, GAME_PHASE_CLOSED},
        {-1, GAME_PHASE_PAUSED, GAME_PHASE_OPEN, GAME_PHASE_CLOSED},
        {-1, -1, -1, GAME_PHASE_CLOSED}
    };
    for (unsigned phase = 0; phase < 4; ++phase) {
        for (unsigned action = 0; action < 4; ++action) {
            game_state_t game = one_voter();
            game.phase = (game_phase_t)phase;
            const game_state_t before = game;
            const game_result_t result = game_control(&game, BOOT, 1u, (game_action_t)action);
            if (expected[phase][action] < 0) {
                CHECK(result == GAME_PHASE_CONFLICT);
                CHECK(memcmp(&before, &game, sizeof(game)) == 0);
            } else {
                CHECK(result == GAME_OK);
                CHECK(game.phase == (game_phase_t)expected[phase][action]);
                CHECK(game.revision == before.revision + (game.phase != before.phase ? 1u : 0u));
                CHECK(game.round == before.round);
                CHECK(game.answer_count == before.answer_count);
            }
            invariant(&game);
        }
        game_state_t game = one_voter();
        game.phase = (game_phase_t)phase;
        const uint32_t before_revision = game.revision;
        CHECK(game_control(&game, BOOT, 1u, GAME_ACTION_RESET) == GAME_OK);
        CHECK(game.phase == GAME_PHASE_LOBBY && game.round == 2u);
        CHECK(game.revision == before_revision + 1u);
        CHECK(game.participants == 1u && game.players[0].joined);
        CHECK(game.answer_count == 0u && game.players[0].last_seq == 0u);
        UNCHANGED(game, game_control(&game, BOOT, 1u, GAME_ACTION_RESET), GAME_ROUND_CONFLICT);
        UNCHANGED(game, game_vote(&game, 1u, BOOT, 1u, 0, 1u), GAME_ROUND_CONFLICT);
        invariant(&game);
    }
}

static void test_control_input_and_boot_identity(void)
{
    game_state_t game = fresh();
    UNCHANGED(game, game_control(&game, "wrong", 1u, GAME_ACTION_OPEN), GAME_INVALID_ARGUMENT);
    UNCHANGED(game, game_control(&game, BOOT, 0u, GAME_ACTION_OPEN), GAME_INVALID_ARGUMENT);
    UNCHANGED(game, game_control(&game, BOOT, 1u, (game_action_t)99), GAME_INVALID_ARGUMENT);
    UNCHANGED(game, game_control(&game, OTHER_BOOT, 1u, GAME_ACTION_OPEN), GAME_ROUND_CONFLICT);
    UNCHANGED(game, game_control(&game, BOOT, 2u, GAME_ACTION_OPEN), GAME_ROUND_CONFLICT);
    CHECK(game_init(&game, OTHER_BOOT) == GAME_OK);
    UNCHANGED(game, game_control(&game, BOOT, 1u, GAME_ACTION_RESET), GAME_ROUND_CONFLICT);
    UNCHANGED(game, game_vote(&game, 1u, BOOT, 1u, 1, 1u), GAME_ROUND_CONFLICT);
    static const char *const actions[] = {"open", "pause", "resume", "close", "reset"};
    for (unsigned i = 0; i < 5; ++i) {
        game_action_t action = GAME_ACTION_RESET;
        CHECK(game_action_from_string(actions[i], &action));
        CHECK(action == (game_action_t)i);
    }
    game_action_t action = GAME_ACTION_PAUSE;
    CHECK(!game_action_from_string("OPEN", &action));
    CHECK(!game_action_from_string("unknown", &action));
    CHECK(!game_action_from_string(NULL, &action));
    CHECK(!game_action_from_string("open", NULL));
    CHECK(action == GAME_ACTION_PAUSE);
}

static void test_all_44_slots_and_snapshots(void)
{
    game_state_t game = fresh();
    char snapshot[GAME_SNAPSHOT_CAPACITY];
    const char *initial =
        "{\"protocol\":1,\"boot\":\"0123456789abcdef\",\"round\":1,"
        "\"revision\":1,\"phase\":\"lobby\",\"role\":\"visitor\","
        "\"joined\":\"00000000000000000000000000000000000000000000\","
        "\"voted\":\"00000000000000000000000000000000000000000000\","
        "\"participants\":0,\"answer_count\":0,\"totals\":null,\"me\":null}";
    CHECK(game_snapshot_json(&game, GAME_ROLE_VISITOR, 0u, snapshot, sizeof(snapshot)) == strlen(initial));
    CHECK(strcmp(snapshot, initial) == 0);
    CHECK(game_snapshot_json(&game, GAME_ROLE_STUDENT, 44u, snapshot, sizeof(snapshot)) > 0u);
    CHECK(strstr(snapshot, "\"me\":{\"id\":44,\"joined\":false,\"choice\":-1,\"last_seq\":0}") != NULL);
    CHECK(game_control(&game, BOOT, 1u, GAME_ACTION_OPEN) == GAME_OK);
    for (unsigned id = 1; id <= GAME_PLAYER_COUNT; ++id) {
        CHECK(game_join(&game, id) == GAME_OK);
        CHECK(game_vote(&game, id, BOOT, 1u, (int)((id - 1u) % 3u), 1u) == GAME_OK);
        UNCHANGED(game, game_join(&game, id), GAME_OK);
    }
    CHECK(game.participants == 44u && game.answer_count == 44u);
    CHECK(game.totals[0] == 15u && game.totals[1] == 15u && game.totals[2] == 14u);
    for (unsigned phase = 0; phase < 4; ++phase) {
        game.phase = (game_phase_t)phase;
        for (unsigned role = 0; role < 3; ++role) {
            const game_state_t before = game;
            const size_t n = game_snapshot_json(&game, (game_role_t)role, 44u, snapshot, sizeof(snapshot));
            CHECK(n == strlen(snapshot) && n > 0u);
            CHECK(memcmp(&before, &game, sizeof(game)) == 0);
            CHECK(strstr(snapshot, "\"joined\":\"11111111111111111111111111111111111111111111\"") != NULL);
            CHECK(strstr(snapshot, "\"voted\":\"11111111111111111111111111111111111111111111\"") != NULL);
            CHECK(strstr(snapshot, phase == GAME_PHASE_CLOSED ? "\"totals\":[15,15,14]" : "\"totals\":null") != NULL);
            if (role == GAME_ROLE_STUDENT) {
                CHECK(strstr(snapshot, "\"me\":{\"id\":44,\"joined\":true,\"choice\":1,\"last_seq\":1}") != NULL);
            } else {
                CHECK(strstr(snapshot, "\"choice\"") == NULL);
                CHECK(strstr(snapshot, "\"last_seq\"") == NULL);
                CHECK(strstr(snapshot, "\"me\":null") != NULL);
            }
        }
    }
    CHECK(game_snapshot_json(&game, GAME_ROLE_STUDENT, 0u, snapshot, sizeof(snapshot)) == 0u);
    CHECK(game_snapshot_json(&game, GAME_ROLE_STUDENT, 45u, snapshot, sizeof(snapshot)) == 0u);
    CHECK(game_snapshot_json(&game, (game_role_t)99, 1u, snapshot, sizeof(snapshot)) == 0u);
    char tiny[2] = {'x', 'z'};
    CHECK(game_snapshot_json(&game, GAME_ROLE_VISITOR, 0u, tiny, 1u) == 0u);
    CHECK(tiny[0] == '\0' && tiny[1] == 'z');
    CHECK(game_snapshot_json(&game, GAME_ROLE_VISITOR, 0u, tiny, 0u) == 0u);
    invariant(&game);
}

static void test_counter_boundaries_are_atomic(void)
{
    game_state_t game = one_voter();
    game.revision = UINT32_MAX;
    UNCHANGED(game, game_join(&game, 2u), GAME_COUNTER_LIMIT);
    UNCHANGED(game, game_join(&game, 1u), GAME_OK);
    UNCHANGED(game, game_vote(&game, 1u, BOOT, 1u, 0, 1u), GAME_OK);
    UNCHANGED(game, game_vote(&game, 1u, BOOT, 1u, 1, 2u), GAME_COUNTER_LIMIT);
    UNCHANGED(game, game_control(&game, BOOT, 1u, GAME_ACTION_OPEN), GAME_OK);
    UNCHANGED(game, game_control(&game, BOOT, 1u, GAME_ACTION_PAUSE), GAME_COUNTER_LIMIT);
    UNCHANGED(game, game_control(&game, BOOT, 1u, GAME_ACTION_RESET), GAME_COUNTER_LIMIT);
    game.revision = 100u;
    game.round = UINT32_MAX;
    UNCHANGED(game, game_control(&game, BOOT, UINT32_MAX, GAME_ACTION_RESET), GAME_COUNTER_LIMIT);
    game.players[0].last_seq = GAME_MAX_SEQUENCE;
    UNCHANGED(game, game_vote(&game, 1u, BOOT, UINT32_MAX, 0, GAME_MAX_SEQUENCE), GAME_OK);
    UNCHANGED(game, game_vote(&game, 1u, BOOT, UINT32_MAX, 1, GAME_MAX_SEQUENCE + 1u), GAME_INVALID_ARGUMENT);
    invariant(&game);
}

int main(void)
{
    test_initialization_and_limits();
    test_invalid_votes_are_atomic();
    test_vote_change_retry_and_reconnect();
    test_complete_transition_contract();
    test_control_input_and_boot_identity();
    test_all_44_slots_and_snapshots();
    test_counter_boundaries_are_atomic();
    printf("PASS: 7 game-core groups, %u checks; sizeof(game_state_t)=%zu bytes\n", checks, sizeof(game_state_t));
    return EXIT_SUCCESS;
}
