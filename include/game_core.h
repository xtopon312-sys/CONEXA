#ifndef CONEXA_GAME_CORE_H
#define CONEXA_GAME_CORE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define GAME_PLAYER_COUNT 44u
#define GAME_CHOICE_COUNT 3u
#define GAME_BOOT_LENGTH 16u
#define GAME_MAX_SEQUENCE UINT32_C(2147483647)
#define GAME_SNAPSHOT_CAPACITY 768u

typedef enum {
    GAME_PHASE_LOBBY = 0,
    GAME_PHASE_OPEN,
    GAME_PHASE_PAUSED,
    GAME_PHASE_CLOSED
} game_phase_t;

typedef enum {
    GAME_ROLE_VISITOR = 0,
    GAME_ROLE_STUDENT,
    GAME_ROLE_TEACHER
} game_role_t;

typedef enum {
    GAME_ACTION_OPEN = 0,
    GAME_ACTION_PAUSE,
    GAME_ACTION_RESUME,
    GAME_ACTION_CLOSE,
    GAME_ACTION_RESET
} game_action_t;

typedef enum {
    GAME_OK = 0,
    GAME_INVALID_ARGUMENT,
    GAME_NOT_JOINED,
    GAME_ROUND_CONFLICT,
    GAME_PHASE_CONFLICT,
    GAME_SEQUENCE_CONFLICT,
    GAME_COUNTER_LIMIT
} game_result_t;

typedef struct {
    bool joined;
    int8_t choice;
    uint32_t last_seq;
} game_player_t;

typedef struct {
    char boot[GAME_BOOT_LENGTH + 1u];
    uint32_t round;
    uint32_t revision;
    game_phase_t phase;
    uint8_t participants;
    uint8_t answer_count;
    uint8_t totals[GAME_CHOICE_COUNT];
    game_player_t players[GAME_PLAYER_COUNT];
} game_state_t;

/* IDs are 1..44. The HTTP layer supplies the authenticated identity. */
bool game_boot_is_valid(const char *boot);
game_result_t game_init(game_state_t *game, const char *boot);
game_result_t game_join(game_state_t *game, unsigned student_id);
game_result_t game_vote(game_state_t *game, unsigned student_id,
                        const char *boot, uint32_t round,
                        int choice, uint32_t seq);
game_result_t game_control(game_state_t *game, const char *boot,
                           uint32_t round, game_action_t action);

const char *game_phase_name(game_phase_t phase);
bool game_action_from_string(const char *text, game_action_t *action);

/* Pure read: totals are hidden until closed; only a student gets its own me.
 * Returns bytes excluding NUL, or zero for invalid input/insufficient space. */
size_t game_snapshot_json(const game_state_t *game, game_role_t role,
                          unsigned student_id, char *buffer,
                          size_t capacity);

#endif
