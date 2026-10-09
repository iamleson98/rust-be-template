//! Admin back office: brands, routes, addresses, schedules, vehicle types,
//! pickup points, review moderation, bookings (stats + CSV export) and bus
//! layouts, one submodule per area.
//!
//! Pure business logic over [`CompositeStore`]: input is validated before it
//! reaches the database and results are typed DTOs from [`crate::dto::admin`].
//! Permissions are checked by the route handlers, not here.

use std::sync::Arc;

use chrono::Utc;

use crate::store::CompositeStore;

mod addresses;
mod bookings;
mod brands;
mod bus_layouts;
mod pickup_points;
mod reviews;
mod routes;
mod schedules;
mod validate;
mod vehicle_types;

pub use validate::slugify;

/// Admin service — pure business logic, no auth knowledge.
///
/// Permission checks are done at the route handler layer via
/// `require_permission(&st, &admin.0, rbac::ADMIN_BRANDS_WRITE).await?`.
pub struct AdminService {
    store: Arc<CompositeStore>,
}

impl AdminService {
    pub fn new(store: Arc<CompositeStore>) -> Self {
        Self { store }
    }
}

/// Trim + drop empty optional strings (`""` → `None`).
fn optional_trimmed(v: Option<&str>) -> Option<String> {
    v.map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// Current UTC time as ISO 8601 string.
fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}
