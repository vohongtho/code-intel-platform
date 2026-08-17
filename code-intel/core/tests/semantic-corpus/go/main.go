package server
type Server struct{}
type Config struct{}
type Handler interface{ Handle(req string) string }
func New() *Server { return &Server{} }
func (s *Server) Start() error { return nil }
func helper() int { return 1 }
