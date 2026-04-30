#include <string>
#include <vector>

namespace server {

class HttpServer {
public:
    explicit HttpServer(int port);
    void start();
    void stop();

private:
    int port_;
    std::string host_;
};

class TcpServer : public HttpServer {
public:
    explicit TcpServer(int port) : HttpServer(port) {}
    void listen();
};

struct Config {
    int port;
    bool debug;
};

enum class Status {
    Running,
    Stopped
};

}  // namespace server

int calculate(int a, int b) {
    return a + b;
}
