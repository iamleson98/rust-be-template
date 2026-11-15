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
