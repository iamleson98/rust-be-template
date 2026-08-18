//! Shared types + helpers used by all payment providers.

// Re-export the constants so providers don't need to go through the entity.
pub use crate::entity::payment::{providers, statuses};

/// Build the memo string embedded in the QR / order info.
///
/// The format is `VEXEVN-{booking_code}` (uppercased) — short, memorable,
/// and easy for the reconciliation script to grep for in bank statements.
/// Vietnamese bank transfer memos are typically capped at 140 chars;
/// we're well under that.
pub fn build_memo(booking_code: &str) -> String {
    format!("VEXEVN-{}", booking_code.to_uppercase())
}

/// Generate a provider-side transaction reference.
///
/// Format: `VX{timestamp_millis}{6_random_alphanum}` — short, unique
/// enough for the table's UNIQUE constraint, and human-scannable.
///
/// - `VX` prefix — easy to grep in bank statements.
/// - `timestamp_millis` (13 digits) — chronological order.
/// - 6 random base36 chars — ~2.1e9 possibilities per millisecond,
///   virtually eliminating collisions under the UNIQUE constraint.
pub fn gen_txn_ref() -> String {
    use rand::Rng;
    let ts = chrono::Utc::now().timestamp_millis();
    let suffix: String = rand::thread_rng()
        .sample_iter(rand::distributions::Alphanumeric)
        .take(6)
        .map(|b| (b as char).to_ascii_uppercase())
        .collect();
    format!("VX{ts}{suffix}")
}
