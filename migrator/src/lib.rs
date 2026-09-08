//! Standalone database migration tool.
//!
//! This crate provides:
//! - A **library** that exports the [`Migrator`] type (used by the main
//!   backend to auto-migrate on startup).
//! - A **binary** (`migrator`) with a CLI for running migrations, generating
//!   entities, and managing the database — completely independent of the
//!   main backend crate so it always compiles even when the backend has
//!   errors.

pub mod migration;

pub use migration::Migrator;

// Force the rustqlite engine onto the migrator BINARY's link line
// (rlib link mode — see .cargo/config.toml and the engine block in the
// workspace root Cargo.toml). The migrator links sqlx-sqlite, whose
// objects carry sqlite3_* undefined references; rustc only keeps the
// `sqlite3` crate's rlib on a final binary's link line when the root
// crate's compilation actually references it. This anchor references
// the compat crate's Rust-visible `engine_version`, pulling the engine
// + compat rlibs (and all 124 sqlite3_* exports) onto the link line.
#[used]
static ENGINE_LINK_ANCHOR: fn() -> &'static str = sqlite3::engine_version;

/// The database engine identity this binary links (rustqlite via the
/// compat C ABI).
pub fn engine_version() -> &'static str {
    sqlite3::engine_version()
}
