//! Data Transfer Objects (DTOs) — the canonical wire shapes that the
//! service layer returns and the API layer marshals into HTTP responses.
//!
//! ## Why dedicated DTOs (not `serde_json::Value`)
//!
//! Previously services returned `serde_json::Value`, which forced route
//! handlers to declare their OpenAPI response bodies as `body = Value`
//! — an opaque JSON blob with no schema. The generated OpenAPI client
//! on the frontend then had no idea what fields the response carried.
//!
//! With typed DTOs:
//! - The service signature is self-documenting — the return type tells
//!   you the exact shape of the data.
//! - The route layer just wraps the DTO in `Json<T>` and utoipa emits
//!   a real schema in the OpenAPI spec.
//! - The frontend's generated client (`openapi-ts`) gets strong types
//!   instead of `unknown`.
//!
//! ## Layout
//!
//! Each domain has its own submodule (`place`, `routing`, `review`,
//! `booking`, `public`). The root `mod.rs` keeps the cross-cutting
//! helpers (`SortOrder`, `ListQuery`, `ListEnvelope`) that every list
//! endpoint shares.

pub mod admin;
pub mod booking;
pub mod chat;
pub mod notification;
pub mod place;
pub mod public;
pub mod review;
pub mod routing;
pub mod wishlist;

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

#[derive(Serialize, Deserialize, ToSchema)]
pub struct BrandInfo {
    // #[serde(flatten)]
    // pub base: crate::entity::brand::Model,
    pub route_count: usize,
    pub layout_count: usize,
}
