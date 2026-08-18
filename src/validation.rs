//! Shared validation helpers used by `#[validate(custom)]` annotations
//! across all route DTOs.
//!
//! Usage:
//! ```ignore
//! #[derive(Deserialize, Validate)]
//! struct MyRequest {
//!     #[validate(length(min = 1, max = 255))]
//!     name: String,
//!     #[validate(custom(function = "crate::validation::validate_phone"))]
//!     phone: String,
//! }
//! ```

use validator::ValidationError;

/// Vietnamese phone validation.
///
/// Accepts:
///   - Domestic: `0XXXXXXXXX` (9-11 digits, starts with 0)
///   - International: `+84XXXXXXXXX` (up to 16 chars total)
///
/// Empty strings are rejected — use `Option<String>` if the field is
/// optional, or `#[validate(custom(function = "..."))]` only on non-empty
/// values (serde will skip validation on `None`).
pub fn validate_phone(phone: &str) -> Result<(), ValidationError> {
    if phone.is_empty() {
        return Err(ValidationError::new("empty_phone"));
    }
    let ok = (phone.starts_with('+')
        && phone[1..].chars().all(|c| c.is_ascii_digit())
        && phone.len() <= 16)
        || (phone.starts_with('0')
            && phone.chars().all(|c| c.is_ascii_digit())
            && (9..=20).contains(&phone.len()));
    if ok {
        Ok(())
    } else {
        Err(ValidationError::new("invalid_phone"))
    }
}

/// Clamp an optional `limit` query param to `[1, max]`.
///
/// ```ignore
/// let limit = crate::validation::clamp_limit(q.limit, 50, 200);
/// ```
pub fn clamp_limit(limit: Option<u64>, default: u64, max: u64) -> u64 {
    limit.unwrap_or(default).clamp(1, max)
}
