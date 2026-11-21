/* Native test transport only. The two production C cores own all game state.
 * This executable is never linked into firmware and knows no real credentials. */
#include "game_core.h"
#include "world_core.h"
#include <inttypes.h>
#include <stdio.h>
#include <string.h>

static void join_states(game_state_t *game, world_state_t *world, unsigned role,
                        unsigned id, game_result_t *p0_result, world_result_t *world_result)
{
    *p0_result = GAME_OK;
    *world_result = WORLD_OK;
    if (role != GAME_ROLE_STUDENT || id < 1u || id > GAME_PLAYER_COUNT) {
        *p0_result = GAME_INVALID_ARGUMENT;
        return;
    }
    /* Mirror main.c's two-core preflight: neither join can partially commit. */
    if (!world->players[id-1u].joined && world->revision == UINT32_MAX) {
        *world_result = WORLD_COUNTER_LIMIT;
        return;
    }
    *p0_result = game_join(game,id);
    if (*p0_result == GAME_OK) *world_result = world_join(world,id);
}

static int join_atomic_check(void)
{
    game_state_t game, before_game;
    world_state_t world, before_world;
    game_result_t p0;
    world_result_t result;
    if (game_init(&game,"1234567890abcdef") != GAME_OK || world_init(&world,"1234567890abcdef") != WORLD_OK) return 5;
    world.revision = UINT32_MAX;
    before_game = game; before_world = world;
    join_states(&game,&world,GAME_ROLE_STUDENT,7u,&p0,&result);
    if (p0 != GAME_OK || result != WORLD_COUNTER_LIMIT || memcmp(&before_game,&game,sizeof(game)) || memcmp(&before_world,&world,sizeof(world))) return 6;
    world.revision = 1u; game.revision = UINT32_MAX;
    before_game = game; before_world = world;
    join_states(&game,&world,GAME_ROLE_STUDENT,7u,&p0,&result);
    if (p0 != GAME_COUNTER_LIMIT || result != WORLD_OK || memcmp(&before_game,&game,sizeof(game)) || memcmp(&before_world,&world,sizeof(world))) return 7;
    game.revision = 1u;
    join_states(&game,&world,GAME_ROLE_STUDENT,7u,&p0,&result);
    if (p0 != GAME_OK || result != WORLD_OK || !game.players[6].joined || !world.players[6].joined) return 8;
    game.revision = world.revision = UINT32_MAX;
    before_game = game; before_world = world;
    join_states(&game,&world,GAME_ROLE_STUDENT,7u,&p0,&result);
    if (p0 != GAME_OK || result != WORLD_OK || memcmp(&before_game,&game,sizeof(game)) || memcmp(&before_world,&world,sizeof(world))) return 9;
    puts("two-core join: world-limit/P0-limit/success/duplicate-limit PASS");
    return 0;
}

int main(int argc, char **argv)
{
    if (argc == 2 && strcmp(argv[1],"--join-atomic-check") == 0) return join_atomic_check();
    game_state_t game;
    world_state_t world;
    char input[512], p0_json[GAME_SNAPSHOT_CAPACITY], world_json[WORLD_SNAPSHOT_CAPACITY];
    if (game_init(&game,"1234567890abcdef") != GAME_OK || world_init(&world,"1234567890abcdef") != WORLD_OK) return 2;
    while (fgets(input,sizeof(input),stdin)) {
        char command = '?', boot[17] = {0}, op_name[16] = {0};
        unsigned role = 0u, id = 0u;
        uint32_t round = 0u, epoch = 0u, seq = 0u, arg = 0u, now_ms = 0u;
        int choice = -1;
        game_result_t p0_result = GAME_OK;
        world_result_t world_result = WORLD_OK;
        if (sscanf(input," %c %u %u",&command,&role,&id) != 3 || role > 2u || (role == 1u && (id == 0u || id > 44u))) return 3;
        switch (command) {
        case 'S': break;
        case 'J':
            join_states(&game,&world,role,id,&p0_result,&world_result);
            break;
        case 'V':
            p0_result = GAME_INVALID_ARGUMENT;
            if (role == GAME_ROLE_STUDENT && sscanf(input," %c %u %u %16s %" SCNu32 " %d %" SCNu32,&command,&role,&id,boot,&round,&choice,&seq) == 7) {
                p0_result = game_vote(&game,id,boot,round,choice,seq);
            }
            break;
        case 'C':
            p0_result = GAME_INVALID_ARGUMENT;
            if (role == GAME_ROLE_TEACHER && sscanf(input," %c %u %u %15s %16s %" SCNu32,&command,&role,&id,op_name,boot,&round) == 6) {
                game_action_t op;
                if (game_action_from_string(op_name,&op)) p0_result = game_control(&game,boot,round,op);
            }
            break;
        case 'W':
            world_result = WORLD_INVALID_ARGUMENT;
            if (sscanf(input," %c %u %u %16s %" SCNu32 " %" SCNu32 " %15s %" SCNu32 " %" SCNu32,&command,&role,&id,boot,&epoch,&seq,op_name,&arg,&now_ms) == 9) {
                world_op_t op;
                if (world_op_from_string(op_name,&op)) world_result = world_apply(&world,(game_role_t)role,id,boot,epoch,seq,op,arg,now_ms);
            }
            break;
        case 'B':
            p0_result = GAME_INVALID_ARGUMENT;
            if (sscanf(input," %c %u %u %16s",&command,&role,&id,boot) == 4) {
                p0_result = game_init(&game,boot);
                if (p0_result == GAME_OK) world_result = world_init(&world,boot);
            }
            break;
        default: p0_result = GAME_INVALID_ARGUMENT; break;
        }
        if (!game_snapshot_json(&game,(game_role_t)role,id,p0_json,sizeof(p0_json)) ||
            !world_snapshot_json(&world,(game_role_t)role,id,world_json,sizeof(world_json))) return 4;
        printf("{\"result\":%d,\"world_result\":%d,\"world_error\":\"%s\",\"p0\":%s,\"world\":%s}\n",
               (int)p0_result,(int)world_result,world_result_name(world_result),p0_json,world_json);
        fflush(stdout);
    }
    return 0;
}
