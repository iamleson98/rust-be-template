//! Database boot-time helpers.
//!
//! Currently one concern: transparently migrating legacy C-SQLite database
//! files to the rustqlite engine the first time the app opens them
//! (see [`sqlite_migrate`]). Only compiled for the `sqlite` backend —
//! the postgres backend has no file-format to convert.

#[cfg(feature = "sqlite")]
pub mod sqlite_migrate;
