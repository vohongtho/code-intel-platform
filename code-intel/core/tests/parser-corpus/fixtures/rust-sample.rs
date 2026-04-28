/// Represents an HTTP server.
#[derive(Debug)]
pub struct Server {
    port: u16,
    host: String,
}

/// Configuration for the server.
pub struct Config {
    pub port: u16,
    pub debug: bool,
}

/// Errors that can occur during server operation.
#[derive(Debug)]
pub enum ServerError {
    BindFailed,
    Timeout,
}

/// A request handler trait.
pub trait Handler {
    fn handle(&self, req: &str) -> String;
}

impl Server {
    /// Creates a new server instance.
    pub fn new(port: u16, host: &str) -> Self {
        Server { port, host: host.to_string() }
    }

    /// Starts the server.
    pub fn start(&self) -> Result<(), ServerError> {
        Ok(())
    }
}

/// Parses a configuration string.
pub fn parse_config(input: &str) -> Config {
    Config { port: 8080, debug: false }
}

fn internal_helper(x: u32) -> u32 {
    x * 2
}
