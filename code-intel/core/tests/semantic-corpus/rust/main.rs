pub struct Server { port: u16 }
pub struct Config { pub port: u16 }
pub enum ServerError { BindFailed, Timeout }
pub trait Handler { fn handle(&self, req: &str) -> String; }
impl Server { pub fn new(port: u16) -> Self { Self { port } } pub fn start(&self) {} }
pub fn parse_config(input: &str) -> Config { Config { port: 8080 } }
fn internal_helper(x: u32) -> u32 { x * 2 }
