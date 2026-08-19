//! Admin routes — all under `/api/admin/*`. Every handler requires the
//! `AdminUser` extractor (authenticated + employee role check) + an RBAC
//! permission check at the route layer.
//!
//! ## Module layout
//!
//! Each sub-module owns its own routes + utoipa path annotations:
//!
//! - `brands` — `/api/admin/brands`
//! - `routes` — `/api/admin/routes` (bus routes, not HTTP routes)
//! - `schedules` — `/api/admin/schedules`
//! - `pickup_points` — `/api/admin/pickup-points`
//! - `bus_layouts` — `/api/admin/bus-layouts`
//! - `reviews` — `/api/admin/reviews` (moderation)
//! - `bookings` — `/api/admin/bookings` (status + stats + export)
//!
//! `payments` lives at `crate::routes::payments` (also handles user-facing
//! payment routes + IPN webhooks), not here — it's mounted directly by
//! `build_router`.
//!
//! ## Why split?
//!
//! The previous `admin.rs` was 725 LOC with 22 handlers. Splitting by
//! domain makes each file ~80–140 LOC, easier to navigate + test, and
//! aligns with how the `service/admin_service.rs` is organised.

pub mod bookings;
pub mod brands;
pub mod bus_layouts;
pub mod pickup_points;
pub mod reviews;
pub mod routes;
pub mod schedules;

use axum::Router;

use crate::state::AppState;

/// Build the admin router — composes all sub-routers under `/api/admin`.
///
/// Each sub-module exposes a `router()` function that returns
/// `Router<AppState>` with paths relative to its prefix (e.g. `brands::router()`
/// mounts at `/` which becomes `/api/admin/brands` after `nest`).
pub fn router() -> Router<AppState> {
    Router::new()
        .nest("/brands", brands::router())
        .nest("/routes", routes::router())
        .nest("/schedules", schedules::router())
        .nest("/pickup-points", pickup_points::router())
        .nest("/bus-layouts", bus_layouts::router())
        .nest("/reviews", reviews::router())
        .nest("/bookings", bookings::router())
}
