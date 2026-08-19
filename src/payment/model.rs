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

// ────────────────────────────────────────────────────────────────
//  Domain constants — kept here so they live next to the entity they
//  constrain. The route + service layers import from here.
// ────────────────────────────────────────────────────────────────

/// Allowed values for `payment.provider`.
pub mod providers {
    pub const VNPAY: &str = "vnpay";
    pub const MOMO: &str = "momo";
    pub const ZALOPAY: &str = "zalopay";
    pub const VIETQR: &str = "vietqr";
    pub const COD: &str = "cod";

    /// All providers in alphabetical order — used by the validation layer.
    pub const ALL: &[&str] = &[MOMO, VNPAY, ZALOPAY, COD, VIETQR];

    /// Providers that require an online gateway (redirect to hosted checkout).
    /// Excludes `vietqr` (rendered as QR locally) and `cod` (offline).
    pub const ONLINE: &[&str] = &[MOMO, VNPAY, ZALOPAY];
}

/// Allowed values for `payment.status`.
pub mod statuses {
    /// Awaiting gateway confirmation (IPN) or QR scan + manual reconcile.
    pub const PENDING: &str = "pending";
    /// Gateway confirmed the payment — booking is now `confirmed`.
    pub const COMPLETED: &str = "completed";
    /// Gateway returned a failure (rejected card, expired wallet, ...).
    /// Booking remains `pending` until the user retries.
    pub const FAILED: &str = "failed";
    /// User / system cancelled before completion (booking expiry, manual).
    pub const CANCELLED: &str = "cancelled";
    /// Refund issued post-completion (separate flow, refund_amount > 0).
    pub const REFUNDED: &str = "refunded";

    pub const ALL: &[&str] = &[PENDING, COMPLETED, FAILED, CANCELLED, REFUNDED];

    /// True if the status represents a terminal state (no further transitions).
    pub fn is_terminal(status: &str) -> bool {
        matches!(status, COMPLETED | FAILED | CANCELLED | REFUNDED)
    }

    /// True if the status represents a state where money was successfully collected.
    pub fn is_paid(status: &str) -> bool {
        matches!(status, COMPLETED | REFUNDED)
    }
}
