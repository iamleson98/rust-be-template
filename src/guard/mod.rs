//! Anti-abuse guards for chat + user-generated content.
//!
//! Currently provides:
//!   * [`abuse::AbuseGuard`] — detects bad-text patterns (profanity,
//!     spam, scams) and temporarily bans the offending user for ~10
//!     minutes.
//!
//! The guard is an in-memory state machine (DashMap-backed) — ban state
//! is not persisted across restarts, which is intentional: bans are
//! short-lived and persisting them creates stale state that's hard to
//! reason about.

pub mod abuse;

pub use abuse::{AbuseGuard, AbuseVerdict};
