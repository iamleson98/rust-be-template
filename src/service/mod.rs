//! Service layer.
//!
//! Sits between routes (API layer) and the store (DB layer):
//!
//! ```text
//! HTTP request → routes/* (thin) → service/* (business logic) → store/* (DB)
//!                                       ↓
//!                                  rbac + cache + auth helpers
//! ```
//!
//! ## Architecture (informed by production Rust patterns)
//!
//! - **Each service holds its dependencies directly** (not a shared
//!   `ServiceContext` and not a back-reference to `AppState`). This
//!   avoids circular `Arc` references and keeps each service's
//!   dependency surface explicit and minimal.
//! - **Services are `Arc<T>` stored on `AppState`** — pre-built once at
//!   startup, shared via cheap `Arc` clones per request. No per-request
//!   service construction.
//! - **`AuthUser` extractor is generic via `FromRef`** — works with any
//!   state that can supply a `JwtValidator`, not just `AppState`. This
//!   makes it testable with a tiny mock state.
//!
//! ## Why a service layer
//!
//! - **Routes stay thin.** Each route handler does only: parse the request,
//!   call the service, format the response. No business logic.
//! - **Services own business invariants.** "User must have `posts:write`
//!   before creating a post" lives here, not scattered across route handlers.
//! - **Testable without HTTP.** A service is just an `Arc<T>` you can
//!   construct directly in tests with mock dependencies.
//! - **Reusable across transports.** The same `PostService` could back
//!   an HTTP route, a gRPC handler, or a CLI command.

pub mod admin_service;
pub mod auth_service;
pub mod booking_service;
pub mod chat_service;
pub mod notification_service;
pub mod payment_service;
pub mod place_service;
pub mod posts_service;
pub mod price_alert_service;
pub mod public_service;
pub mod review_service;
pub mod routing_service;
pub mod users_service;
pub mod wishlist_service;

pub use admin_service::AdminService;
pub use auth_service::AuthService;
pub use booking_service::BookingService;
pub use chat_service::ChatService;
pub use notification_service::NotificationService;
pub use payment_service::PaymentService;
pub use place_service::PlaceService;
pub use posts_service::PostService;
pub use price_alert_service::PriceAlertService;
pub use public_service::PublicService;
pub use review_service::ReviewService;
pub use routing_service::RoutingService;
pub use users_service::UserService;
pub use wishlist_service::WishlistService;
