idf_component_register(
    SRCS "main.c" "game_core.c" "world_core.c"
    INCLUDE_DIRS "../include"
    REQUIRES esp_event esp_http_server esp_netif esp_wifi nvs_flash esp_timer
             esp_hw_support esp_system heap espressif__cjson
)
