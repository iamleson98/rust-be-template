//! Store module split by entity.
//!
//! - Per-entity traits: `UserStore`, `PostStore`, `RbacStore`,
//!   `RefreshTokenStore`, `BrandStore`, `ChatStore`, `BookingStore`,
//!   `ReviewStore`, `RouteStore`, `ScheduleStore`, `TripStore`,
//!   `PlaceStore`, `PriceAlertStore`, `AuditStore`, `NotificationStore`,
//!   `WishlistStore`.
//! - Per-entity DB implementations: each one owns its SeaORM logic and
//!   uses `#[retry]` on that entity's operations.
//! - Per-entity cache wrappers: each one controls cache keys/invalidations
//!   for its own domain.
//! - `CompositeStore`: combines per-entity stores into one object used by
//!   services as `Arc<dyn Store>`.

pub use self::address::{AddressStore, DbAddressStore};
pub use self::audit::{AuditStore, DbAuditStore};
pub use self::booking::{BookingStore, DbBookingStore};
pub use self::brands::{BrandStore, CacheBrandStore, DbBrandStore};
pub use self::chat::{CacheChatStore, ChatStore, DbChatStore, NewChatMessage, NewNullClawExchange};
pub use self::composite::CompositeStore;
pub use self::error::{StoreError, StoreResult};
pub use self::jobs::{DbJobStore, JobStore};

// Timestamp helpers shared by the job scheduler pieces (store rows,
// services, job handlers). Fixed-width ISO-8601 UTC strings — see
// `store::jobs` module docs for the lexicographic-ordering contract.
pub(crate) use self::jobs::{now_iso, parse_iso};
pub use self::notification::{DbNotificationStore, NotificationStore};
pub use self::payment::{DbPaymentStore, PaymentStore};
pub use self::place::{DbPlaceStore, PlaceStore};
pub use self::posts::{CachePostStore, DbPostStore, PostStore};
pub use self::price_alert::{DbPriceAlertStore, PriceAlertStore};
pub use self::rbac::UserPermissions;
pub use self::rbac::{CacheRbacStore, DbRbacStore, RbacStore};
pub use self::refresh_tokens::{CacheRefreshTokenStore, DbRefreshTokenStore, RefreshTokenStore};
pub use self::review::{DbReviewStore, ReviewStore};
pub use self::route::{DbRouteStore, PickupPointWithRoute, RouteStore};
pub use self::schedule::{DbScheduleStore, ScheduleStore};
pub use self::trip::{DbTripStore, TripStore};
pub use self::users::{CacheUserStore, DbUserStore, UserStore};
pub use self::vehicle_types::{DbVehicleTypeStore, VehicleTypePage, VehicleTypeStore};
pub use self::wishlist::{DbWishlistStore, WishlistStore};

/// Parse a `&str` UUID into a [`uuid::Uuid`], mapping failures to
/// [`StoreError::Validation`].
///
/// Why this exists: several store methods accept ids as `&str` (the
/// wire-facing convention). On SQLite, SeaORM stores `Uuid` columns as
/// 16-byte BLOBs, so filtering with `.eq(some_string)` (a TEXT parameter)
/// NEVER matches — BLOB ≠ TEXT in SQLite's comparison rules. Binding the
/// parsed [`uuid::Uuid`] (a BLOB parameter) matches correctly, and on
/// Postgres both forms work. Every `&str`-id filter must go through this.
pub(crate) fn parse_uuid(s: &str) -> StoreResult<uuid::Uuid> {
    uuid::Uuid::parse_str(s).map_err(|_| StoreError::Validation(format!("invalid UUID: {s:?}")))
}

#[macro_use]
mod macros;
mod address;
mod audit;
mod booking;
mod brands;
pub mod chat;
mod composite;
mod error;
mod jobs;
mod notification;
mod payment;
mod place;
mod posts;
mod price_alert;
mod rbac;
mod refresh_tokens;
mod retry;
mod review;
mod route;
mod schedule;
mod trip;
mod users;
mod vehicle_types;
mod wishlist;
