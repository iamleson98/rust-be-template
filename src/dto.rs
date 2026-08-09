//! System-wide DTOs (Data Transfer Objects).
//!
//! This module centralizes the request/response shapes that cross the
//! HTTP boundary so they are consistent across every route handler:
//!
//! - [`ListQuery`] — standard `limit` / `offset` / `sort` / `order`
//!   pagination + sorting parameters, parsed from the query string.
//! - [`ListEnvelope`] — the canonical `{ items, total, limit, offset }`
//!   response envelope every list endpoint returns. The frontend's
//!   `ListEnvelope<T>` type mirrors this exactly.
//! - [`SortOrder`] — `asc` / `desc` enum, case-insensitive on input.
//!
//! ## Why centralize?
//!
//! Before this module, each route defined its own `ListQuery` struct
//! with ad-hoc `limit` / `offset` fields and no sorting. That meant:
//!   - Inconsistent pagination defaults (some used 20, some 50).
//!   - No sorting support anywhere.
//!   - The frontend had to know each endpoint's quirks.
//!
//! Now every list endpoint accepts the same query shape and returns the
//! same envelope. Domain-specific filters are layered on top by
//! composing `ListQuery` into a domain filter struct (see
//! `PriceAlertListFilter` in `service/price_alert_service.rs`).
//!
//! ## Usage
//!
//! ```ignore
//! use axum::extract::Query;
//! use backend::dto::{ListQuery, ListEnvelope};
//!
//! #[derive(Deserialize)]
//! struct MyFilter {
//!     #[serde(flatten)]
//!     base: ListQuery,
//!     status: Option<String>,
//! }
//!
//! async fn list(Query(q): Query<MyFilter>) -> Json<ListEnvelope<MyOut>> {
//!     // q.base.limit, q.base.offset, q.base.sort, q.base.order
//!     // ...
//! }
//! ```

use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

/// Sort direction. Case-insensitive on input (`asc` / `desc`).
#[derive(Debug, Clone, Copy, Deserialize, Serialize, ToSchema, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SortOrder {
    #[default]
    Asc,
    Desc,
}

impl std::fmt::Display for SortOrder {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SortOrder::Asc => write!(f, "asc"),
            SortOrder::Desc => write!(f, "desc"),
        }
    }
}

/// Standard list-query parameters: pagination + sorting.
///
/// Every list endpoint should accept this (directly or via `#[serde(flatten)]`
/// in a domain-specific filter struct). Defaults:
/// - `limit` = 20 (clamped to 200 by the service layer)
/// - `offset` = 0
/// - `sort` = `created_at` (the service may override per-domain)
/// - `order` = `desc`
///
/// `sort` is a free-form string — the service layer validates it against
/// an allow-list of sortable columns for that domain (prevents SQL
/// injection via column names).
#[derive(Debug, Clone, Deserialize, IntoParams, Default)]
#[into_params(parameter_in = Query)]
pub struct ListQuery {
    /// Max items to return. Clamped to `[1, 200]` by the service.
    #[serde(default = "default_limit")]
    pub limit: u64,
    /// Number of items to skip.
    #[serde(default)]
    pub offset: u64,
    /// Sort field. The service validates this against an allow-list.
    #[serde(default = "default_sort")]
    pub sort: String,
    /// Sort direction: `asc` or `desc`.
    #[serde(default)]
    pub order: SortOrder,
}

fn default_limit() -> u64 {
    20
}

fn default_sort() -> String {
    "created_at".to_string()
}

impl ListQuery {
    /// Clamp `limit` to the `[1, max]` range. Called by services after
    /// extracting the query.
    pub fn clamped_limit(&self, max: u64) -> u64 {
        self.limit.clamp(1, max)
    }
}

/// The canonical list-response envelope.
///
/// Mirrors the frontend's `ListEnvelope<T>`:
/// ```ts
/// type ListEnvelope<T> = { items: T[]; total?: number; ... }
/// ```
///
/// `total` is the total count of matching rows (before pagination) —
/// useful for the frontend to render "Showing 1-20 of 347". Services
/// should populate it when cheap to compute; otherwise omit (it's
/// `Option`).
#[derive(Debug, Serialize, ToSchema)]
pub struct ListEnvelope<T: ToSchema> {
    pub items: Vec<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    pub limit: u64,
    pub offset: u64,
}

impl<T: ToSchema> ListEnvelope<T> {
    pub fn new(items: Vec<T>, limit: u64, offset: u64) -> Self {
        Self {
            items,
            total: None,
            limit,
            offset,
        }
    }

    pub fn with_total(mut self, total: u64) -> Self {
        self.total = Some(total);
        self
    }
}
