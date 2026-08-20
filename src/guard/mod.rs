//! Anti-abuse guards for chat + user-generated content.
//!
//! Currently provides:
//!   * [`abuse::AbuseGuard`] — detects bad-text patterns (profanity,
//!     all-caps shouting, phone-number spam, repeat-spam) and
//!     temporarily bans the offending user for ~10 minutes.
//!
//! The guard is an in-memory state machine (DashMap-backed) — ban state
//! is not persisted across restarts, which is intentional: bans are
//! short-lived and persisting them creates stale state that's hard to
//! reason about.
//!
//! ## Heuristics NOT included
//!
//!   * **Message-length abuse** — handled in the frontend chat-input
//!     component (500-char hard limit + disabled send button). The
//!     backend `ChatStore` also enforces a reasonable cap on the
//!     `content` column.
//!   * **URL spam** — flagged as too noisy; legitimate customer-service
//!     URLs (booking links, payment receipts) frequently appear in chat.
//!     The user explicitly requested this be removed.
//!
//! Both could be re-added later if real-world abuse patterns warrant.

pub mod abuse;

pub use abuse::{AbuseGuard, AbuseVerdict};
