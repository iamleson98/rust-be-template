//! Store module split by entity.
//!
//! - Per-entity traits: `UserStore`, `PostStore`, `RbacStore`,
//!   `RefreshTokenStore`, `BrandStore`, `ChatStore`, `BookingStore`,
//!   `ReviewStore`, `RouteStore`, `ScheduleStore`, `TripStore`,
//!   `PlaceStore`, `PriceAlertStore`, `AuditStore`.
//! - Per-entity DB implementations: each one owns its SeaORM logic and
//!   uses `#[retry]` on that entity's operations.
//! - Per-entity cache wrappers: each one controls cache keys/invalidations
//!   for its own domain.
//! - `CompositeStore`: combines per-entity stores into one object used by
//!   services as `Arc<dyn Store>`.

pub use self::error::{StoreError, StoreResult};
pub use self::retry::RetryPolicy;
pub use self::rbac::{UserPermissions};
pub use self::users::{CacheUserStore, DbUserStore, UserStore};
pub use self::posts::{CachePostStore, DbPostStore, PostStore};
pub use self::rbac::{CacheRbacStore, DbRbacStore, RbacStore};
pub use self::refresh_tokens::{
	CacheRefreshTokenStore,
	DbRefreshTokenStore,
	RefreshTokenStore,
};
pub use self::brands::{BrandStore, CacheBrandStore, DbBrandStore};
pub use self::chat::{CacheChatStore, ChatStore, DbChatStore, NewChatMessage, NewZeroClawExchange};
pub use self::booking::{BookingStore, DbBookingStore};
pub use self::review::{DbReviewStore, ReviewStore};
pub use self::route::{DbRouteStore, RouteStore};
pub use self::schedule::{DbScheduleStore, ScheduleStore};
pub use self::trip::{DbTripStore, TripStore};
pub use self::place::{DbPlaceStore, PlaceStore};
pub use self::price_alert::{DbPriceAlertStore, PriceAlertStore};
pub use self::audit::{AuditStore, DbAuditStore};
pub use self::composite::CompositeStore;

#[macro_use]
mod macros;
mod error;
mod retry;
mod users;
mod posts;
mod rbac;
mod refresh_tokens;
mod brands;
pub mod chat;
mod booking;
mod review;
mod route;
mod schedule;
mod trip;
mod place;
mod price_alert;
mod audit;
mod composite;
