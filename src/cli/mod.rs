//! Command-line interface for the backend.
//!
//! Built with `clap`. Subcommands:
//!
//! - `serve` — start the HTTP server (default if no subcommand given)
//! - `routes list` — print all registered routes (introspection)
//! - `config show` — print the resolved config (with secrets masked)
//! - `key generate` — generate a fresh 32-byte JWT secret
//! - `key hash <PASSWORD>` — hash a password with argon2
//!
//! Database migration commands have been moved to the standalone `migrator`
//! binary. Build it with: `cargo build -p migrator --release`

pub use self::parser::{Cli, Command};
pub use self::runner::run;

mod commands;
mod parser;
mod runner;
mod util;
