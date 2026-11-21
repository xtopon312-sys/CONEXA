/* Host-only deterministic tests. Synthetic time and identities do not measure
 * ESP32 radio capacity or real simultaneous devices. No private inputs. */
#include "world_core.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static unsigned checks, groups;
#define CHECK(condition) do { ++checks; if (!(condition)) { fprintf(stderr,"FAIL %s:%d: %s\n",__FILE__,__LINE__,#condition); exit(1); } } while (0)
static const char *boot = "0123456789abcdef";
static uint32_t clock_ms = 1000u;

static void fresh(world_state_t *w)
{
    CHECK(world_init(w, boot) == WORLD_OK);
    clock_ms = 1000u;
}

static world_result_t action(world_state_t *w, game_role_t role, unsigned id,
                             uint32_t seq, world_op_t op, uint32_t arg)
{
    world_state_t before = *w;
    world_result_t r = world_apply(w,role,id,w->boot,w->epoch,seq,op,arg,clock_ms);
    if (r != WORLD_OK) CHECK(memcmp(&before,w,sizeof(before)) == 0);
    return r;
}

static void teach(world_state_t *w, world_op_t op)
{
    CHECK(action(w,GAME_ROLE_TEACHER,0u,w->teacher_seq + 1u,op,0u) == WORLD_OK);
}

static void inspect(world_state_t *w, unsigned id, unsigned mission, unsigned clue)
{
    CHECK(action(w,GAME_ROLE_STUDENT,id,w->players[id-1u].seq+1u,WORLD_OP_INSPECT,mission*8u+clue) == WORLD_OK);
}

static void walk(world_state_t *w, unsigned id, int x, int y)
{
    static const int deltas[4][2] = {{1,0},{0,1},{-1,0},{0,-1}};
    world_player_t *p = &w->players[id-1u];
    int remaining = world_path_distance(p->x,p->y,x,y);
    CHECK(remaining >= 0);
    while (remaining > 0) {
        bool moved = false;
        for (size_t i = 0; i < 4u; ++i) {
            int nx = (int)p->x + deltas[i][0], ny = (int)p->y + deltas[i][1];
            if (world_path_distance(nx,ny,x,y) != remaining-1) continue;
            clock_ms += WORLD_MOVE_INTERVAL_MS;
            CHECK(action(w,GAME_ROLE_STUDENT,id,p->seq+1u,WORLD_OP_MOVE,(uint32_t)ny*WORLD_SIZE+(uint32_t)nx) == WORLD_OK);
            CHECK((int)p->x == nx && (int)p->y == ny);
            --remaining;
            moved = true;
            break;
        }
        CHECK(moved);
    }
}

static void initialization_and_map(void)
{
    world_state_t w;
    fresh(&w);
    CHECK(w.epoch == 1u && w.revision == 1u && w.phase == GAME_PHASE_LOBBY);
    CHECK(world_init(NULL,boot) == WORLD_INVALID_ARGUMENT);
    CHECK(world_init(&w,"bad") == WORLD_INVALID_ARGUMENT);
    CHECK(world_join(&w,0u) == WORLD_INVALID_ARGUMENT);
    CHECK(world_join(&w,45u) == WORLD_INVALID_ARGUMENT);
    for (unsigned id = 1; id <= GAME_PLAYER_COUNT; ++id) {
        CHECK(world_walkable(w.players[id-1u].x,w.players[id-1u].y));
        CHECK(w.players[id-1u].decisions[0] == -1);
        for (unsigned j = 1; j < id; ++j) CHECK(w.players[j-1u].x != w.players[id-1u].x || w.players[j-1u].y != w.players[id-1u].y);
        CHECK(world_join(&w,id) == WORLD_OK);
        world_state_t copy = w;
        CHECK(world_join(&w,id) == WORLD_OK);
        CHECK(memcmp(&copy,&w,sizeof(w)) == 0);
    }
    CHECK(w.players[6].x == 7u && w.players[6].y == 9u);
    CHECK(world_init(&w,w.boot) == WORLD_OK);
    CHECK(strcmp(w.boot,boot) == 0 && !w.players[0].joined);
    CHECK(!world_walkable(-1,0) && !world_walkable(14,0) && !world_walkable(0,14));
    CHECK(world_path_distance(7,9,7,9) == 0);
    CHECK(world_path_distance(7,9,7,7) == -1);
    CHECK(world_path_distance(6,7,9,7) > 3); /* Fountain forces detour. */
    for (int y = 0; y < 14; ++y) for (int x = 0; x < 14; ++x) {
        int d = world_path_distance(7,9,x,y);
        CHECK((d >= 0) == world_walkable(x,y));
        if (d >= 0) CHECK(world_path_distance(x,y,7,9) == d);
    }
    for (int op = WORLD_OP_MOVE; op <= WORLD_OP_RESET; ++op) {
        world_op_t parsed = WORLD_OP_MOVE;
        CHECK(world_op_from_string(world_op_name((world_op_t)op),&parsed));
        CHECK(parsed == (world_op_t)op);
    }
    CHECK(!world_op_from_string("MOVE",NULL));
    world_op_t parsed;
    CHECK(!world_op_from_string("teleport",&parsed));
    CHECK(world_op_name((world_op_t)99) == NULL);
    CHECK(strcmp(world_result_name((world_result_t)99),"unknown") == 0);
    ++groups;
}

static void authorization_sequence_and_retry(void)
{
    world_state_t w;
    fresh(&w);
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,1u,WORLD_OP_MOVE,135u) == WORLD_NOT_JOINED);
    CHECK(world_join(&w,7u) == WORLD_OK);
    for (int op = WORLD_OP_MOVE; op <= WORLD_OP_RESET; ++op) {
        CHECK(action(&w,GAME_ROLE_VISITOR,0u,1u,(world_op_t)op,0u) == WORLD_FORBIDDEN);
        if (op > WORLD_OP_RESOLVE) CHECK(action(&w,GAME_ROLE_STUDENT,7u,1u,(world_op_t)op,0u) == WORLD_FORBIDDEN);
        else CHECK(action(&w,GAME_ROLE_TEACHER,0u,1u,(world_op_t)op,0u) == WORLD_FORBIDDEN);
    }
    CHECK(action(&w,(game_role_t)3,0u,1u,WORLD_OP_START,0u) == WORLD_INVALID_ARGUMENT);
    CHECK(action(&w,GAME_ROLE_STUDENT,45u,1u,WORLD_OP_MOVE,0u) == WORLD_INVALID_ARGUMENT);
    CHECK(action(&w,GAME_ROLE_TEACHER,0u,1u,WORLD_OP_START,1u) == WORLD_INVALID_ARGUMENT);
    CHECK(action(&w,GAME_ROLE_TEACHER,0u,0u,WORLD_OP_START,0u) == WORLD_INVALID_ARGUMENT);
    CHECK(action(&w,GAME_ROLE_TEACHER,0u,GAME_MAX_SEQUENCE+1u,WORLD_OP_START,0u) == WORLD_INVALID_ARGUMENT);
    CHECK(action(&w,GAME_ROLE_TEACHER,0u,2u,WORLD_OP_START,0u) == WORLD_SEQUENCE_CONFLICT);
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,1u,WORLD_OP_MOVE,135u) == WORLD_PHASE_CONFLICT);
    CHECK(world_apply(&w,GAME_ROLE_TEACHER,0u,"1123456789abcdef",1u,1u,WORLD_OP_START,0u,0u) == WORLD_SESSION_CONFLICT);
    CHECK(world_apply(&w,GAME_ROLE_TEACHER,0u,boot,2u,1u,WORLD_OP_START,0u,0u) == WORLD_SESSION_CONFLICT);
    teach(&w,WORLD_OP_START);
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,2u,WORLD_OP_MOVE,135u) == WORLD_SEQUENCE_CONFLICT);
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,1u,WORLD_OP_MOVE,135u) == WORLD_OK);
    world_state_t after = w;
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,1u,WORLD_OP_MOVE,135u) == WORLD_OK);
    CHECK(memcmp(&after,&w,sizeof(w)) == 0);
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,1u,WORLD_OP_MOVE,134u) == WORLD_SEQUENCE_CONFLICT);
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,1u,WORLD_OP_INSPECT,0u) == WORLD_SEQUENCE_CONFLICT);
    teach(&w,WORLD_OP_PAUSE);
    after = w;
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,1u,WORLD_OP_MOVE,135u) == WORLD_OK);
    CHECK(memcmp(&after,&w,sizeof(w)) == 0);
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,2u,WORLD_OP_MOVE,136u) == WORLD_PHASE_CONFLICT);
    CHECK(action(&w,GAME_ROLE_TEACHER,0u,3u,WORLD_OP_START,0u) == WORLD_PHASE_CONFLICT);
    teach(&w,WORLD_OP_RESUME);
    teach(&w,WORLD_OP_FINISH);
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,2u,WORLD_OP_MOVE,136u) == WORLD_PHASE_CONFLICT);
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,1u,WORLD_OP_MOVE,135u) == WORLD_OK);
    ++groups;
}

static void movement_budget_and_clock_wrap(void)
{
    world_state_t w;
    fresh(&w);
    CHECK(world_join(&w,7u) == WORLD_OK);
    teach(&w,WORLD_OP_START);
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,1u,WORLD_OP_MOVE,196u) == WORLD_INVALID_ARGUMENT);
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,1u,WORLD_OP_MOVE,133u) == WORLD_INVALID_ARGUMENT);
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,1u,WORLD_OP_MOVE,105u) == WORLD_COLLISION);
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,1u,WORLD_OP_MOVE,0u) == WORLD_TOO_FAR);
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,1u,WORLD_OP_MOVE,128u) == WORLD_RATE_LIMIT); /* 5 first tiles. */
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,1u,WORLD_OP_MOVE,137u) == WORLD_OK); /* 4. */
    CHECK(w.players[6].x == 11u && w.players[6].movement_credit_ms == 0u);
    clock_ms += 799u;
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,2u,WORLD_OP_MOVE,136u) == WORLD_RATE_LIMIT);
    clock_ms += 1u;
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,2u,WORLD_OP_MOVE,133u) == WORLD_RATE_LIMIT); /* 800ms buys only 3 tiles. */
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,2u,WORLD_OP_MOVE,134u) == WORLD_OK);
    CHECK(w.players[6].movement_credit_ms == 50u);
    clock_ms += 10000u;
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,3u,WORLD_OP_MOVE,128u) == WORLD_OK); /* Accumulation is capped at 6 tiles. */
    CHECK(w.players[6].movement_credit_ms == 0u);
    fresh(&w);
    CHECK(world_join(&w,7u) == WORLD_OK);
    teach(&w,WORLD_OP_START);
    clock_ms = UINT32_MAX - 300u;
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,1u,WORLD_OP_MOVE,134u) == WORLD_OK);
    clock_ms += 800u;
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,2u,WORLD_OP_MOVE,135u) == WORLD_OK);
    CHECK(w.players[6].x == 9u);
    ++groups;
}

static void evidence_release_and_proximity(void)
{
    world_state_t w;
    fresh(&w);
    CHECK(world_join(&w,7u) == WORLD_OK);
    teach(&w,WORLD_OP_START);
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,1u,WORLD_OP_INSPECT,0u) == WORLD_TOO_FAR);
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,1u,WORLD_OP_INSPECT,8u) == WORLD_PHASE_CONFLICT);
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,1u,WORLD_OP_INSPECT,4u) == WORLD_INVALID_ARGUMENT);
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,1u,WORLD_OP_INSPECT,24u) == WORLD_INVALID_ARGUMENT);
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,1u,WORLD_OP_RESOLVE,201u) == WORLD_TOO_FAR);
    CHECK(action(&w,GAME_ROLE_TEACHER,0u,2u,WORLD_OP_NEXT,0u) == WORLD_NOT_RELEASED);
    walk(&w,7u,10,4);
    inspect(&w,7u,0u,0u);
    inspect(&w,7u,0u,0u); /* Reopening evidence is allowed, still sequenced. */
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,w.players[6].seq+1u,WORLD_OP_RESOLVE,201u) == WORLD_EVIDENCE_REQUIRED);
    walk(&w,7u,12,6);
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,w.players[6].seq+1u,WORLD_OP_INSPECT,3u) == WORLD_NOT_RELEASED);
    teach(&w,WORLD_OP_RELEASE);
    teach(&w,WORLD_OP_NEXT); /* Catch-up in mission 0 remains possible. */
    inspect(&w,7u,0u,3u);
    walk(&w,7u,5,5); inspect(&w,7u,0u,1u);
    walk(&w,7u,6,10); inspect(&w,7u,0u,2u);
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,w.players[6].seq+1u,WORLD_OP_RESOLVE,201u) == WORLD_TOO_FAR);
    walk(&w,7u,10,4);
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,w.players[6].seq+1u,WORLD_OP_RESOLVE,200u) == WORLD_EVIDENCE_REQUIRED);
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,w.players[6].seq+1u,WORLD_OP_RESOLVE,3u*256u+201u) == WORLD_INVALID_ARGUMENT);
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,w.players[6].seq+1u,WORLD_OP_RESOLVE,2u*256u+201u) == WORLD_OK);
    CHECK(w.players[6].done == 1u && w.players[6].decisions[0] == 2);
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,w.players[6].seq+1u,WORLD_OP_RESOLVE,201u) == WORLD_ALREADY_COMPLETED);
    teach(&w,WORLD_OP_PAUSE);
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,w.players[6].seq,WORLD_OP_RESOLVE,2u*256u+201u) == WORLD_OK);
    CHECK(action(&w,GAME_ROLE_TEACHER,0u,w.teacher_seq+1u,WORLD_OP_RELEASE,0u) == WORLD_PHASE_CONFLICT);
    ++groups;
}

static void full_three_mission_flow_44(world_state_t *w)
{
    static const int sites[4][2] = {{10,4},{5,5},{6,10},{12,6}};
    static const unsigned links[3] = {201u,114u,141u};
    fresh(w);
    for (unsigned id = 1u; id <= GAME_PLAYER_COUNT; ++id) CHECK(world_join(w,id) == WORLD_OK);
    teach(w,WORLD_OP_START);
    for (unsigned m = 0u; m < WORLD_MISSION_COUNT; ++m) {
        teach(w,WORLD_OP_RELEASE);
        for (unsigned id = 1u; id <= GAME_PLAYER_COUNT; ++id) {
            for (unsigned clue = 0u; clue < 4u; ++clue) {
                walk(w,id,sites[clue][0],sites[clue][1]);
                inspect(w,id,m,clue);
            }
            walk(w,id,10,4);
            uint32_t arg = m*4096u + (id%3u)*256u + links[m];
            uint32_t seq = w->players[id-1u].seq+1u;
            CHECK(action(w,GAME_ROLE_STUDENT,id,seq,WORLD_OP_RESOLVE,arg) == WORLD_OK);
            world_state_t after = *w;
            CHECK(action(w,GAME_ROLE_STUDENT,id,seq,WORLD_OP_RESOLVE,arg) == WORLD_OK);
            CHECK(memcmp(&after,w,sizeof(after)) == 0);
            CHECK(w->players[id-1u].done == (1u << (m+1u))-1u);
        }
        if (m < 2u) teach(w,WORLD_OP_NEXT);
        else CHECK(action(w,GAME_ROLE_TEACHER,0u,w->teacher_seq+1u,WORLD_OP_NEXT,0u) == WORLD_PHASE_CONFLICT);
    }
    char json[WORLD_SNAPSHOT_CAPACITY];
    CHECK(world_snapshot_json(w,GAME_ROLE_VISITOR,0u,json,sizeof(json)) > 0u);
    CHECK(strstr(json,"\"completed\":[44,44,44]") != NULL);
    CHECK(strstr(json,"\"decisions\":null") != NULL);
    teach(w,WORLD_OP_FINISH);
    CHECK(world_snapshot_json(w,GAME_ROLE_VISITOR,0u,json,sizeof(json)) > 0u);
    CHECK(strstr(json,"\"decisions\":[[14,15,15],[14,15,15],[14,15,15]]") != NULL);
    CHECK(strstr(json,"\"me\":null,\"teacher\":null") != NULL);
    ++groups;
}

static void reset_recovery_and_counters(void)
{
    world_state_t w;
    fresh(&w);
    CHECK(world_join(&w,7u) == WORLD_OK);
    CHECK(world_join(&w,44u) == WORLD_OK);
    teach(&w,WORLD_OP_START);
    walk(&w,7u,6,10); inspect(&w,7u,0u,2u);
    teach(&w,WORLD_OP_RESET);
    CHECK(w.epoch == 2u && w.teacher_seq == 0u && w.mission == 0u && w.released == 0u);
    CHECK(w.players[6].joined && w.players[43].joined && !w.players[0].joined);
    CHECK(w.players[6].x == 7u && w.players[6].y == 9u && w.players[43].x == 10u && w.players[43].y == 0u);
    CHECK(w.players[6].seq == 0u && w.players[6].clues[0] == 0u && w.players[6].decisions[0] == -1);
    world_state_t after = w;
    CHECK(world_apply(&w,GAME_ROLE_TEACHER,0u,boot,1u,2u,WORLD_OP_RESET,0u,clock_ms) == WORLD_OK);
    CHECK(memcmp(&after,&w,sizeof(w)) == 0);
    teach(&w,WORLD_OP_START);
    after = w;
    CHECK(world_apply(&w,GAME_ROLE_TEACHER,0u,boot,1u,2u,WORLD_OP_RESET,0u,clock_ms) == WORLD_OK);
    CHECK(memcmp(&after,&w,sizeof(w)) == 0);
    CHECK(world_apply(&w,GAME_ROLE_TEACHER,0u,boot,1u,2u,WORLD_OP_PAUSE,0u,clock_ms) == WORLD_SESSION_CONFLICT);
    CHECK(world_apply(&w,GAME_ROLE_STUDENT,7u,boot,1u,1u,WORLD_OP_MOVE,134u,clock_ms) == WORLD_SESSION_CONFLICT);
    teach(&w,WORLD_OP_RESET);
    CHECK(world_apply(&w,GAME_ROLE_TEACHER,0u,boot,1u,2u,WORLD_OP_RESET,0u,clock_ms) == WORLD_SESSION_CONFLICT);
    CHECK(world_init(&w,"1123456789abcdef") == WORLD_OK);
    CHECK(w.epoch == 1u && !w.players[6].joined && !w.has_reset_receipt);
    CHECK(world_apply(&w,GAME_ROLE_TEACHER,0u,boot,1u,1u,WORLD_OP_START,0u,clock_ms) == WORLD_SESSION_CONFLICT);
    fresh(&w);
    w.revision = UINT32_MAX;
    CHECK(world_join(&w,7u) == WORLD_COUNTER_LIMIT);
    CHECK(action(&w,GAME_ROLE_TEACHER,0u,1u,WORLD_OP_START,0u) == WORLD_COUNTER_LIMIT);
    w.revision = 1u;
    w.epoch = UINT32_MAX;
    CHECK(action(&w,GAME_ROLE_TEACHER,0u,1u,WORLD_OP_RESET,0u) == WORLD_COUNTER_LIMIT);
    CHECK(!w.has_reset_receipt && w.epoch == UINT32_MAX);
    w.teacher_seq = GAME_MAX_SEQUENCE-1u;
    teach(&w,WORLD_OP_START);
    CHECK(w.teacher_seq == GAME_MAX_SEQUENCE);
    after = w;
    CHECK(action(&w,GAME_ROLE_TEACHER,0u,GAME_MAX_SEQUENCE,WORLD_OP_START,0u) == WORLD_OK);
    CHECK(memcmp(&after,&w,sizeof(w)) == 0);
    CHECK(action(&w,GAME_ROLE_TEACHER,0u,1u,WORLD_OP_PAUSE,0u) == WORLD_SEQUENCE_CONFLICT);
    ++groups;
}

static void snapshots_and_privacy(const world_state_t *completed)
{
    char json[WORLD_SNAPSHOT_CAPACITY], small[2] = {'x','x'};
    CHECK(world_snapshot_json(completed,GAME_ROLE_TEACHER,0u,json,sizeof(json)) > 0u);
    CHECK(strlen(json) < WORLD_SNAPSHOT_CAPACITY);
    CHECK(strstr(json,"\"last_op\":\"finish\"") != NULL);
    CHECK(strstr(json,"\"me\":null") != NULL);
    CHECK(strstr(json,"\"progress\":\"fff7fff7") != NULL);
    CHECK(world_snapshot_json(completed,GAME_ROLE_STUDENT,7u,json,sizeof(json)) > 0u);
    CHECK(strstr(json,"\"teacher\":null") != NULL);
    CHECK(strstr(json,"\"id\":7,\"joined\":true") != NULL);
    CHECK(strstr(json,"\"last_op\":\"resolve\",\"last_arg\":8589") != NULL);
    CHECK(strstr(json,"\"progress\"") == NULL);
    CHECK(world_snapshot_json(completed,GAME_ROLE_VISITOR,0u,json,sizeof(json)) > 0u);
    CHECK(strstr(json,"\"last_op\"") == NULL);
    CHECK(strstr(json,"\"id\"") == NULL);
    CHECK(world_snapshot_json(completed,GAME_ROLE_STUDENT,0u,json,sizeof(json)) == 0u);
    CHECK(world_snapshot_json(completed,(game_role_t)4,0u,json,sizeof(json)) == 0u);
    CHECK(world_snapshot_json(completed,GAME_ROLE_VISITOR,0u,small,sizeof(small)) == 0u && small[0] == '\0');
    CHECK(world_snapshot_json(NULL,GAME_ROLE_VISITOR,0u,json,sizeof(json)) == 0u);
    world_state_t w;
    fresh(&w);
    CHECK(world_snapshot_json(&w,GAME_ROLE_STUDENT,7u,json,sizeof(json)) > 0u);
    CHECK(strstr(json,"\"last_op\":null,\"last_arg\":0") != NULL);
    CHECK(strstr(json,"\"joined\":false") != NULL);
    w.epoch = w.revision = UINT32_MAX;
    w.teacher_seq = GAME_MAX_SEQUENCE;
    w.teacher_last_op = WORLD_OP_RELEASE;
    CHECK(world_snapshot_json(&w,GAME_ROLE_TEACHER,0u,json,sizeof(json)) > 0u);
    CHECK(strstr(json,"\"epoch\":4294967295") != NULL);
    CHECK(strstr(json,"\"seq\":2147483647") != NULL);
    ++groups;
}

static void phase_matrix_and_atomic_limits(void)
{
    /* All control transitions, including negative paths, use the same sequence. */
    static const world_result_t expected[4][7] = {
        {WORLD_OK,WORLD_PHASE_CONFLICT,WORLD_PHASE_CONFLICT,WORLD_PHASE_CONFLICT,WORLD_PHASE_CONFLICT,WORLD_PHASE_CONFLICT,WORLD_OK},
        {WORLD_PHASE_CONFLICT,WORLD_OK,WORLD_PHASE_CONFLICT,WORLD_OK,WORLD_NOT_RELEASED,WORLD_OK,WORLD_OK},
        {WORLD_PHASE_CONFLICT,WORLD_PHASE_CONFLICT,WORLD_OK,WORLD_PHASE_CONFLICT,WORLD_PHASE_CONFLICT,WORLD_OK,WORLD_OK},
        {WORLD_PHASE_CONFLICT,WORLD_PHASE_CONFLICT,WORLD_PHASE_CONFLICT,WORLD_PHASE_CONFLICT,WORLD_PHASE_CONFLICT,WORLD_PHASE_CONFLICT,WORLD_OK}
    };
    for (int phase = GAME_PHASE_LOBBY; phase <= GAME_PHASE_CLOSED; ++phase) {
        for (int op = WORLD_OP_START; op <= WORLD_OP_RESET; ++op) {
            world_state_t w;
            fresh(&w);
            w.phase = (game_phase_t)phase;
            CHECK(action(&w,GAME_ROLE_TEACHER,0u,1u,(world_op_t)op,0u) == expected[phase][op-WORLD_OP_START]);
        }
    }
    world_state_t w;
    fresh(&w);
    CHECK(world_join(&w,7u) == WORLD_OK);
    teach(&w,WORLD_OP_START);
    const uint32_t invalid[] = {UINT32_MAX,UINT32_MAX-1u,UINT32_C(2147483648),65535u,1234567u};
    for (size_t i = 0u; i < sizeof(invalid)/sizeof(invalid[0]); ++i) {
        CHECK(action(&w,GAME_ROLE_STUDENT,7u,1u,WORLD_OP_MOVE,invalid[i]) == WORLD_INVALID_ARGUMENT);
        CHECK(action(&w,GAME_ROLE_STUDENT,7u,1u,WORLD_OP_INSPECT,invalid[i]) == WORLD_INVALID_ARGUMENT);
        CHECK(action(&w,GAME_ROLE_STUDENT,7u,1u,WORLD_OP_RESOLVE,invalid[i]) == WORLD_INVALID_ARGUMENT);
    }
    w.players[6].seq = GAME_MAX_SEQUENCE-1u;
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,GAME_MAX_SEQUENCE,WORLD_OP_MOVE,134u) == WORLD_OK);
    w.revision = UINT32_MAX;
    world_state_t after = w;
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,GAME_MAX_SEQUENCE,WORLD_OP_MOVE,134u) == WORLD_OK);
    CHECK(memcmp(&after,&w,sizeof(w)) == 0);
    CHECK(action(&w,GAME_ROLE_STUDENT,7u,1u,WORLD_OP_MOVE,135u) == WORLD_SEQUENCE_CONFLICT);
    CHECK(world_join(&w,7u) == WORLD_OK);
    CHECK(world_join(&w,8u) == WORLD_COUNTER_LIMIT);
    CHECK(action(&w,GAME_ROLE_TEACHER,0u,2u,WORLD_OP_RESET,0u) == WORLD_COUNTER_LIMIT);
    CHECK(!w.has_reset_receipt && w.epoch == 1u);
    ++groups;
}

int main(int argc, char **argv)
{
    if (argc == 2 && strcmp(argv[1],"--map") == 0) {
        for (int y = 0; y < 14; ++y) for (int x = 0; x < 14; ++x) putchar(world_walkable(x,y)?'1':'0');
        putchar('\n');
        return 0;
    }
    world_state_t completed;
    initialization_and_map();
    authorization_sequence_and_retry();
    movement_budget_and_clock_wrap();
    evidence_release_and_proximity();
    full_three_mission_flow_44(&completed);
    reset_recovery_and_counters();
    snapshots_and_privacy(&completed);
    phase_matrix_and_atomic_limits();
    if (argc == 2 && strcmp(argv[1],"--snapshots") == 0) {
        char json[WORLD_SNAPSHOT_CAPACITY];
        for (int role = GAME_ROLE_VISITOR; role <= GAME_ROLE_TEACHER; ++role) {
            CHECK(world_snapshot_json(&completed,(game_role_t)role,7u,json,sizeof(json)) > 0u);
            puts(json);
        }
    } else printf("world_core: %u groups, %u checks PASS; sizeof(world_state_t)=%zu; logical44 only, no hardware\n",groups,checks,sizeof(world_state_t));
    return 0;
}
