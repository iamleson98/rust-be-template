//! Command-line interface for the backend.
//!
//! Built with `clap`. Subcommands:
//!
//! - `serve` — start the HTTP server (default if no subcommand given)
//! - `routes list` — print all registered routes (introspection)
//! - `config show` — print the resolved config (with secrets masked)
//! - `key generate` — generate a fresh 32-byte JWT secret
//! - `key hash <PASSWORD>` — hash a password with argon2
//! - `ads-sweep` — backfill-upload stored ad conversions to Google Ads
//! - `layouts-normalize` — give legacy bus layouts a real seat plan
//! - `places-build` — build a place-index generation from the OSM extract
//!   (the weekly `places.build` job runs it as a child; by hand it is a diagnostic)
//! - `import-d1` — import a Cloudflare D1 export into the app database
//!
//! Database migration commands have been moved to the standalone `migrator`
//! binary. Build it with: `cargo build -p migrator --release`

pub use self::parser::{Cli, Command};
pub use self::runner::run;

mod commands;
pub mod import_d1;
mod parser;
mod runner;
pub mod util;
