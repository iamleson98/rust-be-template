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

pub use self::audit::{AuditStore, DbAuditStore};
pub use self::booking::{BookingStore, DbBookingStore};
pub use self::brands::{BrandStore, CacheBrandStore, DbBrandStore};
pub use self::chat::{CacheChatStore, ChatStore, DbChatStore, NewChatMessage, NewZeroClawExchange};
pub use self::composite::CompositeStore;
pub use self::error::{StoreError, StoreResult};
pub use self::notification::{DbNotificationStore, NotificationStore};
pub use self::place::{DbPlaceStore, PlaceStore};
pub use self::posts::{CachePostStore, DbPostStore, PostStore};
pub use self::price_alert::{DbPriceAlertStore, PriceAlertStore};
pub use self::rbac::UserPermissions;
pub use self::rbac::{CacheRbacStore, DbRbacStore, RbacStore};
pub use self::refresh_tokens::{CacheRefreshTokenStore, DbRefreshTokenStore, RefreshTokenStore};
pub use self::review::{DbReviewStore, ReviewStore};
pub use self::route::{DbRouteStore, RouteStore};
pub use self::schedule::{DbScheduleStore, ScheduleStore};
pub use self::trip::{DbTripStore, TripStore};
pub use self::users::{CacheUserStore, DbUserStore, UserStore};
pub use self::wishlist::{DbWishlistStore, WishlistStore};

#[macro_use]
mod macros;
mod audit;
mod booking;
mod brands;
pub mod chat;
mod composite;
mod error;
mod notification;
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
mod wishlist;
