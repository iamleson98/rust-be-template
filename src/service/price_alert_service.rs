//! Price alert service — business logic for price alert CRUD.
//!
//! ## Design
//! - Uses `CompositeStore` (PriceAlertStore) for all DB access.
//! - Uses `Uuid` instead of `cuid2` for ID generation.
//! - Returns domain models (`price_alert::Model`), NOT JSON. The route
//!   layer is responsible for mapping models to JSON DTOs. This keeps
//!   the service reusable across transports (HTTP, WS, CLI) and makes
//!   the JSON shape a thin, swappable presentation concern.
//! - Input validation lives here (phone format, price > 0, etc.).

use std::sync::Arc;

use sea_orm::Set;
use uuid::Uuid;

use crate::entity::price_alert;
use crate::error::{AppError, AppResult};
use crate::store::CompositeStore;

// ────────────────────────────────────────────────────────────────
//  Input / filter DTOs
// ────────────────────────────────────────────────────────────────

/// Input for creating a price alert.
///
/// `user_id` is supplied by the route layer from the authenticated
/// session (NOT trusted from the client). For guest-created alerts it
/// is `None` and the alert is keyed by `phone` only.
#[derive(Debug, Clone)]
pub struct CreatePriceAlertInput {
    pub user_id: Option<Uuid>,
    pub phone: String,
    pub email: Option<String>,
    pub from_name: String,
    pub to_name: String,
    pub route_id: Option<String>,
    pub target_price: i64,
    pub frequency: String,
}

/// Filter for listing price alerts.
///
/// Exactly one of `user_id` / `phone` should be set:
/// - `user_id` — the authenticated owner (preferred).
/// - `phone` — guest lookup (used by the dialog's "existing alerts"
///   preview before login).
#[derive(Debug, Clone, Default)]
pub struct PriceAlertListFilter {
    pub user_id: Option<Uuid>,
    pub phone: Option<String>,
    pub status: Option<String>,
    pub limit: u64,
    pub offset: u64,
}

// ────────────────────────────────────────────────────────────────
//  Service
// ────────────────────────────────────────────────────────────────

pub struct PriceAlertService {
    store: Arc<CompositeStore>,
}

impl PriceAlertService {
    pub fn new(store: Arc<CompositeStore>) -> Self {
        Self { store }
    }

    // ── List ────────────────────────────────────────────────────

    /// List price alerts for an owner (user_id) or a phone (guest).
    ///
    /// Returns the raw models + the total count (before pagination) so
    /// the route layer can populate the `total` field of the envelope.
    pub async fn list(
        &self,
        filter: &PriceAlertListFilter,
    ) -> AppResult<(Vec<price_alert::Model>, u64)> {
        let limit = filter.limit.min(200);
        let status = filter.status.as_deref();

        match (filter.user_id, filter.phone.as_deref()) {
            (Some(uid), _) => {
                let uid_str = uid.to_string();
                let items = self
                    .store
                    .price_alert_store()
                    .list_alerts_by_user(&uid_str, status, limit, filter.offset)
                    .await?;
                let total = self
                    .store
                    .price_alert_store()
                    .count_alerts(Some(&uid_str), None, status)
                    .await?;
                Ok((items, total))
            }
            (None, Some(phone)) => {
                let phone = phone.trim();
                if phone.is_empty() {
                    return Err(AppError::BadRequest("phone is required".into()));
                }
                let items = self
                    .store
                    .price_alert_store()
                    .list_alerts_by_phone(phone, status, limit, filter.offset)
                    .await?;
                let total = self
                    .store
                    .price_alert_store()
                    .count_alerts(None, Some(phone), status)
                    .await?;
                Ok((items, total))
            }
            (None, None) => Err(AppError::BadRequest(
                "either user_id or phone is required".into(),
            )),
        }
    }

    // ── Get ─────────────────────────────────────────────────────

    /// Get a single alert by id. Returns the raw model.
    pub async fn get(&self, id: Uuid) -> AppResult<price_alert::Model> {
        self.store
            .price_alert_store()
            .find_price_alert_by_id(id)
            .await?
            .ok_or_else(|| AppError::NotFound("price alert not found".into()))
    }

    // ── Create ──────────────────────────────────────────────────

    /// Create a price alert with deduplication.
    ///
    /// If an active alert already exists for the same owner + route +
    /// target price, returns the existing one instead of creating a
    /// duplicate.
    ///
    /// Returns `(model, created)` where `created` is `false` if a
    /// duplicate was returned. The route layer uses this to set the
    /// `duplicate` flag in the JSON DTO.
    pub async fn create(
        &self,
        input: &CreatePriceAlertInput,
    ) -> AppResult<(price_alert::Model, bool)> {
        let phone = input.phone.trim();
        if phone.is_empty() {
            return Err(AppError::BadRequest("phone is required".into()));
        }
        if !is_valid_vn_phone(phone) {
            return Err(AppError::BadRequest(
                "invalid Vietnamese phone number".into(),
            ));
        }
        if input.from_name.trim().is_empty() || input.to_name.trim().is_empty() {
            return Err(AppError::BadRequest(
                "from_name and to_name are required".into(),
            ));
        }
        if input.target_price <= 0 {
            return Err(AppError::BadRequest("target_price must be positive".into()));
        }
        let freq = if input.frequency.trim().is_empty() {
            "daily".to_string()
        } else {
            input.frequency.trim().to_string()
        };

        // Deduplication: check for existing active alert with same
        // owner/route/target.
        let existing = self
            .store
            .price_alert_store()
            .find_duplicate_alert(
                input.user_id.as_ref().map(|u| u.to_string()).as_deref(),
                phone,
                input.route_id.as_deref(),
                input.target_price,
            )
            .await?;

        if let Some(a) = existing {
            return Ok((a, false));
        }

        let now = chrono::Utc::now();
        let expires_at = now + chrono::Duration::days(30);

        let alert = price_alert::ActiveModel {
            id: Set(Uuid::new_v4()),
            user_id: Set(input.user_id.map(|u| u.to_string())),
            phone: Set(phone.to_string()),
            email: Set(input.email.as_ref().map(|e| e.trim().to_string())),
            from_name: Set(Some(input.from_name.trim().to_string())),
            to_name: Set(Some(input.to_name.trim().to_string())),
            route_id: Set(input.route_id.as_ref().map(|r| r.trim().to_string())),
            target_price: Set(Some(input.target_price)),
            frequency: Set(freq),
            status: Set("active".to_string()),
            created_at: Set(now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)),
            expires_at: Set(Some(
                expires_at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
            )),
            last_triggered_at: Set(None),
        };

        let result = self
            .store
            .price_alert_store()
            .insert_price_alert(alert)
            .await
            .map_err(|e| {
                tracing::error!(error = ?e, "failed to insert price alert");
                AppError::Internal(e.to_string())
            })?;

        Ok((result, true))
    }

    // ── Remove ──────────────────────────────────────────────────

    /// Soft-delete a price alert (set status to "cancelled").
    ///
    /// `caller_user_id` is the authenticated user. If the alert has a
    /// `user_id` that does not match, returns `Forbidden`. Legacy
    /// phone-only alerts (null `user_id`) may be cancelled by anyone
    /// who knows the id (guest flow).
    pub async fn remove(
        &self,
        id: Uuid,
        caller_user_id: Option<Uuid>,
    ) -> AppResult<price_alert::Model> {
        let alert = self
            .store
            .price_alert_store()
            .find_price_alert_by_id(id)
            .await?
            .ok_or_else(|| AppError::NotFound("price alert not found".into()))?;

        // Ownership check: if the alert is owned by a user, only that
        // user may cancel it.
        if let (Some(owner), Some(caller)) = (alert.user_id.as_deref(), caller_user_id) {
            if let Ok(owner_uid) = Uuid::parse_str(owner) {
                if owner_uid != caller {
                    return Err(AppError::Forbidden(
                        "can only cancel your own price alerts".into(),
                    ));
                }
            }
        }

        let mut active: price_alert::ActiveModel = alert.into();
        active.status = Set("cancelled".to_string());
        let result = self
            .store
            .price_alert_store()
            .update_price_alert(active)
            .await
            .map_err(|e| {
                tracing::error!(error = ?e, "failed to update price alert");
                AppError::Internal(e.to_string())
            })?;

        Ok(result)
    }
}

// ────────────────────────────────────────────────────────────────
//  Pure helpers
// ────────────────────────────────────────────────────────────────

/// Validate a Vietnamese phone number.
///
/// Accepts formats: `0xxxxxxxxx`, `+84xxxxxxxxx`, `84xxxxxxxxx`.
/// Must be 10 digits after normalization (starting with 0).
fn is_valid_vn_phone(phone: &str) -> bool {
    let digits: String = phone.chars().filter(|c| c.is_ascii_digit()).collect();
    let normalized = if digits.starts_with("84") {
        format!("0{}", &digits[2..])
    } else {
        digits
    };
    normalized.len() == 10
        && normalized.starts_with('0')
        && normalized[1..2]
            .chars()
            .next()
            .map(|c| ('3'..='9').contains(&c))
            .unwrap_or(false)
}

// ────────────────────────────────────────────────────────────────
//  Unit tests
// ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_vn_phone_mobile() {
        assert!(is_valid_vn_phone("0912345678"));
        assert!(is_valid_vn_phone("0312345678"));
        assert!(is_valid_vn_phone("0812345678"));
    }

    #[test]
    fn valid_vn_phone_with_country_code() {
        assert!(is_valid_vn_phone("+84912345678"));
        assert!(is_valid_vn_phone("84912345678"));
    }

    #[test]
    fn invalid_vn_phone_too_short() {
        assert!(!is_valid_vn_phone("091234567"));
    }

    #[test]
    fn invalid_vn_phone_wrong_prefix() {
        assert!(!is_valid_vn_phone("0112345678")); // starts with 01
    }

    #[test]
    fn invalid_vn_phone_landline() {
        assert!(!is_valid_vn_phone("0241234567")); // 9 digits after 0
    }
}
