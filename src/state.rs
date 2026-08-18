use std::sync::Arc;

use axum::extract::FromRef;

use crate::config::Config;
use crate::rbac::RbacChecker;
use crate::service::{
    AdminService, AuthService, BookingService, NotificationService, PlaceService, PostService,
    PriceAlertService, PublicService, ReviewService, RoutingService, UserService, WishlistService,
};
use crate::store::CompositeStore;

/// The single application state object shared across handlers.
///
/// ## Design (informed by production Rust patterns)
///
/// - **`AppState` is `Clone`** (cheap — every field is `Arc<T>`). This
///   is the idiomatic axum pattern: use `State<AppState>` directly,
///   without an extra `Arc` wrapper. Axum clones the state per request,
///   but each clone is just a refcount bump.
/// - **Services are pre-built `Arc<T>` stored on AppState.** Constructed
///   once at startup; shared via cheap `Arc` clones per request. No
///   per-request service construction.
/// - **Services hold their deps directly** (not a back-reference to
///   `AppState`). This avoids circular `Arc` references — a common
///   memory leak pitfall.
/// - **`RbacChecker` is on `AppState`** — shared by all route handlers
///   via `st.rbac.require(user_id, permission).await?`. Services no
///   longer carry their own `RbacChecker` field; permission checks live
///   at the route handler layer.
/// - **`AuthUser` extractor is generic via `FromRef`** — works with any
///   state that can supply an `AuthService`, not just `AppState`.
///   This keeps middleware independent of the concrete app state type.
///
/// ## WebSocket hubs
///
/// The chat (`/ws`) and audio-call (`/ws-call`) hubs are process-global
/// singletons (see `ws::hub::hub()` and `audio_call::hub::call_hub()`).
/// They are NOT stored on `AppState` — this matches the booking-rs
/// design and keeps `AppState` focused on per-request deps.
#[derive(Clone)]
pub struct AppState {
    // ---- Shared infrastructure ----
    pub config: Arc<Config>,
    pub store: Arc<CompositeStore>,
    pub rbac: Arc<RbacChecker>,

    // ---- Domain services (pre-built, shared via Arc) ----
    pub auth: Arc<AuthService>,
    pub posts: Arc<PostService>,
    pub users: Arc<UserService>,
    pub admin: Arc<AdminService>,
    pub reviews: Arc<ReviewService>,
    pub bookings: Arc<BookingService>,
    pub public: Arc<PublicService>,
    pub routing: Arc<RoutingService>,
    pub places: Arc<PlaceService>,
    pub price_alerts: Arc<PriceAlertService>,
    pub notifications: Arc<NotificationService>,
    pub wishlist: Arc<WishlistService>,
}

/// `Arc<Config>` is also extractable — useful for handlers that need
/// config values without taking the whole `AppState`.
impl FromRef<AppState> for Arc<Config> {
    fn from_ref(state: &AppState) -> Self {
        state.config.clone()
    }
}

impl FromRef<AppState> for Arc<AuthService> {
    fn from_ref(state: &AppState) -> Self {
        state.auth.clone()
    }
}

impl FromRef<AppState> for Arc<PostService> {
    fn from_ref(state: &AppState) -> Self {
        state.posts.clone()
    }
}

impl FromRef<AppState> for Arc<UserService> {
    fn from_ref(state: &AppState) -> Self {
        state.users.clone()
    }
}

impl FromRef<AppState> for Arc<AdminService> {
    fn from_ref(state: &AppState) -> Self {
        state.admin.clone()
    }
}

impl FromRef<AppState> for Arc<ReviewService> {
    fn from_ref(state: &AppState) -> Self {
        state.reviews.clone()
    }
}

impl FromRef<AppState> for Arc<BookingService> {
    fn from_ref(state: &AppState) -> Self {
        state.bookings.clone()
    }
}

impl FromRef<AppState> for Arc<PublicService> {
    fn from_ref(state: &AppState) -> Self {
        state.public.clone()
    }
}

impl FromRef<AppState> for Arc<RoutingService> {
    fn from_ref(state: &AppState) -> Self {
        state.routing.clone()
    }
}

impl FromRef<AppState> for Arc<PlaceService> {
    fn from_ref(state: &AppState) -> Self {
        state.places.clone()
    }
}

impl FromRef<AppState> for Arc<PriceAlertService> {
    fn from_ref(state: &AppState) -> Self {
        state.price_alerts.clone()
    }
}

impl FromRef<AppState> for Arc<NotificationService> {
    fn from_ref(state: &AppState) -> Self {
        state.notifications.clone()
    }
}

impl FromRef<AppState> for Arc<WishlistService> {
    fn from_ref(state: &AppState) -> Self {
        state.wishlist.clone()
    }
}
