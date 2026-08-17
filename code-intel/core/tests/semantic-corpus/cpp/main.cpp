namespace server {
class HttpServer { public: void start(); void stop(); };
class TcpServer : public HttpServer { public: void listen(); };
struct Config { int port; };
}
int calculate(int a, int b) { return a + b; }
