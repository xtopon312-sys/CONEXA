#ifndef CONEXA_WORLD_CORE_H
#define CONEXA_WORLD_CORE_H

#include "game_core.h"

#define WORLD_SIZE 14u
#define WORLD_MISSION_COUNT 3u
#define WORLD_CLUE_COUNT 4u
#define WORLD_SNAPSHOT_CAPACITY 3072u
#define WORLD_MOVE_INTERVAL_MS 800u
#define WORLD_TILE_TIME_MS 250u
#define WORLD_MAX_MOVE_TILES 6u

typedef enum {
    WORLD_OP_MOVE = 0, WORLD_OP_INSPECT, WORLD_OP_RESOLVE,
    WORLD_OP_START, WORLD_OP_PAUSE, WORLD_OP_RESUME, WORLD_OP_RELEASE,
    WORLD_OP_NEXT, WORLD_OP_FINISH, WORLD_OP_RESET
} world_op_t;

typedef enum {
    WORLD_OK = 0, WORLD_INVALID_ARGUMENT, WORLD_FORBIDDEN,
    WORLD_NOT_JOINED, WORLD_SESSION_CONFLICT, WORLD_PHASE_CONFLICT,
    WORLD_SEQUENCE_CONFLICT, WORLD_COUNTER_LIMIT, WORLD_COLLISION,
    WORLD_RATE_LIMIT, WORLD_TOO_FAR, WORLD_EVIDENCE_REQUIRED,
    WORLD_NOT_RELEASED, WORLD_ALREADY_COMPLETED
} world_result_t;

typedef struct {
    bool joined;
    uint8_t x, y;
    uint8_t clues[WORLD_MISSION_COUNT];
    uint8_t done;
    int8_t decisions[WORLD_MISSION_COUNT];
    uint32_t seq;
    world_op_t last_op;
    uint32_t last_arg;
    bool has_moved;
    uint32_t last_move_ms;
    uint16_t movement_credit_ms;
} world_player_t;

typedef struct {
    char boot[GAME_BOOT_LENGTH + 1u];
    uint32_t epoch, revision;
    game_phase_t phase;
    uint8_t mission, released;
    world_player_t players[GAME_PLAYER_COUNT];
    uint32_t teacher_seq;
    world_op_t teacher_last_op;
    uint32_t teacher_last_arg;
    bool has_reset_receipt;
    uint32_t reset_epoch, reset_seq;
} world_state_t;

/* All identity arguments come from the existing authenticated HTTP layer.
 * Authorization, sequencing and game rules are checked again in this core.
 * The caller serializes access; functions allocate no heap memory. */
world_result_t world_init(world_state_t *world, const char *boot);
world_result_t world_join(world_state_t *world, unsigned student_id);
world_result_t world_apply(world_state_t *world, game_role_t role,
                          unsigned student_id, const char *boot,
                          uint32_t epoch, uint32_t seq, world_op_t op,
                          uint32_t arg, uint32_t now_ms);
bool world_op_from_string(const char *text, world_op_t *op);
const char *world_op_name(world_op_t op);
const char *world_result_name(world_result_t result);
bool world_walkable(int x, int y);
/* Returns shortest walkable distance, or -1 if invalid/unreachable. */
int world_path_distance(int from_x, int from_y, int to_x, int to_y);
/* positions: 44 pairs of hex x/y, '--' for absent; teacher progress:
 * 44 groups of clue-mask0/1/2/completed-mask, '----' for absent.
 * Individual answers are only returned to the authenticated student.
 * Aggregate decisions are public only after finish, always visible to teacher.
 * Returns bytes excluding NUL, zero for invalid input/insufficient capacity. */
size_t world_snapshot_json(const world_state_t *world, game_role_t role,
                           unsigned student_id, char *buffer, size_t capacity);

#endif
