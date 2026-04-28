#include <stdio.h>
#include <stdlib.h>

/* Server configuration */
typedef struct {
    int port;
    int debug;
} Config;

/* Point structure */
struct Point {
    int x;
    int y;
};

/* Initialize the server */
int server_init(int port) {
    return 0;
}

/* Start listening */
void server_start(Config *cfg) {
    printf("Starting on port %d\n", cfg->port);
}

/* Internal helper */
static int internal_calc(int x) {
    return x * 2;
}

/* Parse config from string */
Config parse_config(const char *input) {
    Config cfg = {8080, 0};
    return cfg;
}
