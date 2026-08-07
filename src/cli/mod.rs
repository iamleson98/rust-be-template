//! Command-line interface for the backend.
//!
//! Built with `clap`. Subcommands:
//!
//! - `serve` — start the HTTP server (default if no subcommand given)
//! - `migrate up` — apply pending migrations
//! - `migrate down` — revert the last N migrations (default 1)
//! - `migrate list` — show applied / pending migrations
//! - `migration new <NAME>` — scaffold a new migration file from template
//! - `entity generate` — generate SeaORM entities from the live DB schema
//!   (shells out to `sea-orm-cli`, which must be installed)
//! - `db shell` — open an interactive psql / sqlite3 shell
//! - `db reset` — drop all tables + re-run migrations
//! - `routes list` — print all registered routes (introspection)
//! - `config show` — print the resolved config (with secrets masked)
//! - `key generate` — generate a fresh 32-byte JWT secret
//! - `key hash <PASSWORD>` — hash a password with argon2

pub use self::parser::{Cli, Command};
pub use self::runner::run;

mod commands;
mod parser;
mod runner;
mod util;
