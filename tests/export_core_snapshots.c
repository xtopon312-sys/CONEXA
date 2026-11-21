/* Development-only fixture exporter. It executes the same core and serializer
 * linked into the firmware; it opens no socket and is not an alternate backend. */
#include "game_core.h"

#include <stdio.h>
#include <stdlib.h>

#define REQUIRE_OK(operation) do { \
    const game_result_t result_ = (operation); \
    if (result_ != GAME_OK) { \
        fprintf(stderr, "Core operation failed: %s (%d)\n", #operation, (int)result_); \
        exit(EXIT_FAILURE); \
    } \
} while (0)

static void emit_view(const game_state_t *game, const char *case_name,
                      const char *viewer, game_role_t role, unsigned student_id)
{
    char snapshot[GAME_SNAPSHOT_CAPACITY];
    if (game_snapshot_json(game, role, student_id, snapshot, sizeof(snapshot)) == 0u) {
        fprintf(stderr, "Snapshot serialization failed: %s/%s\n", case_name, viewer);
        exit(EXIT_FAILURE);
    }
    /* All wrapper labels are fixed test strings. The snapshot is emitted
     * unchanged from the production C serializer, including its JSON types. */
    printf("{\"case\":\"%s\",\"viewer\":\"%s\",\"snapshot\":%s}\n",
           case_name, viewer, snapshot);
}

static void emit_case(const game_state_t *game, const char *case_name)
{
    emit_view(game, case_name, "visitor", GAME_ROLE_VISITOR, 0u);
    emit_view(game, case_name, "student_1", GAME_ROLE_STUDENT, 1u);
    emit_view(game, case_name, "student_44", GAME_ROLE_STUDENT, 44u);
    emit_view(game, case_name, "teacher", GAME_ROLE_TEACHER, 0u);
}

int main(void)
{
    game_state_t game;
    REQUIRE_OK(game_init(&game, "1234567890abcdef"));
    emit_case(&game, "initial");

    for (unsigned id = 1u; id <= GAME_PLAYER_COUNT; ++id) {
        REQUIRE_OK(game_join(&game, id));
    }
    emit_case(&game, "lobby_44");
    REQUIRE_OK(game_control(&game, game.boot, game.round, GAME_ACTION_OPEN));
    emit_case(&game, "open_empty");

    for (unsigned id = 1u; id <= GAME_PLAYER_COUNT; ++id) {
        REQUIRE_OK(game_vote(&game, id, game.boot, game.round,
                             (int)((id - 1u) % GAME_CHOICE_COUNT), 1u));
    }
    emit_case(&game, "open_voted");

    for (unsigned id = 1u; id <= GAME_PLAYER_COUNT; ++id) {
        REQUIRE_OK(game_join(&game, id));
    }
    REQUIRE_OK(game_vote(&game, 1u, game.boot, game.round, 0, 1u));
    emit_case(&game, "reconnected");

    REQUIRE_OK(game_control(&game, game.boot, game.round, GAME_ACTION_PAUSE));
    emit_case(&game, "paused");
    REQUIRE_OK(game_vote(&game, 44u, game.boot, game.round, 1, 1u));
    emit_case(&game, "paused_retried");
    REQUIRE_OK(game_control(&game, game.boot, game.round, GAME_ACTION_RESUME));
    emit_case(&game, "resumed");

    REQUIRE_OK(game_vote(&game, 1u, game.boot, game.round, 2, 2u));
    emit_case(&game, "changed");
    REQUIRE_OK(game_control(&game, game.boot, game.round, GAME_ACTION_CLOSE));
    emit_case(&game, "closed");
    REQUIRE_OK(game_vote(&game, 1u, game.boot, game.round, 2, 2u));
    emit_case(&game, "closed_retried");

    REQUIRE_OK(game_control(&game, game.boot, game.round, GAME_ACTION_RESET));
    emit_case(&game, "reset");

    /* Set only the boundary counter as a fixture, avoiding billions of resets.
     * Opening, voting and serialization still execute the actual C core. */
    game.round = UINT32_MAX;
    REQUIRE_OK(game_control(&game, game.boot, game.round, GAME_ACTION_OPEN));
    emit_case(&game, "round_max");
    REQUIRE_OK(game_vote(&game, 44u, game.boot, game.round, 2, 1u));
    emit_case(&game, "round_max_voted");
    return EXIT_SUCCESS;
}
