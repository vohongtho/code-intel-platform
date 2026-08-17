typedef struct { int port; } Config;
struct Point { int x; int y; };
int server_init(int port) { return port; }
void server_start(Config *cfg) {}
static int internal_calc(int x) { return x * 2; }
Config parse_config(const char *input) { Config cfg = {0}; return cfg; }
