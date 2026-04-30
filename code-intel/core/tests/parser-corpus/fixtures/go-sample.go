// Package server provides the HTTP server implementation.
package server

import "fmt"

// Server handles HTTP requests.
type Server struct {
	Port int
	Host string
}

// Config stores configuration values.
type Config struct {
	Port    int
	Debug   bool
}

// Handler is the interface for request handlers.
type Handler interface {
	Handle(req string) string
}

// New creates a new Server instance.
func New(port int, host string) *Server {
	return &Server{Port: port, Host: host}
}

// Start begins listening for connections.
func (s *Server) Start() error {
	fmt.Printf("Listening on %s:%d\n", s.Host, s.Port)
	return nil
}

// Stop shuts down the server.
func (s *Server) Stop() {
	fmt.Println("Server stopped")
}

// helper is an internal function.
func helper(x int) int {
	return x * 2
}
