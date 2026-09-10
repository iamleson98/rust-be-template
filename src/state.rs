use std::sync::Arc;

use axum::extract::FromRef;

use crate::config::Config;
use crate::rbac::RbacChecker;
use crate::service::{
    AdminService, AuthService, BookingService, ChatService, JobService, NotificationService,
    PaymentService, PlaceService, PostService, PriceAlertService, PublicService, ReviewService,
    RouteMediaService, RoutingService, UserService, WishlistService,
};

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
/// ## Clean architecture — store is NOT public
///
/// The `CompositeStore` is intentionally NOT exposed as a public field
/// on `AppState`. All store access goes through the domain services
/// (`st.auth`, `st.chats`, `st.bookings`, etc.). Route handlers + WS
/// handlers must NEVER call `st.store.*` directly — they call the
/// corresponding service method, which encapsulates business logic +
/// validation + the store call.
///
/// This enforces the layering:
///   ```text
///   HTTP / WS → routes/* (thin) → service/* (business logic) → store/* (DB)
///   ```
/// Keeping the store private prevents the common anti-pattern of route
/// handlers accumulating business logic by reaching into the store.
///
/// The `store` field here exists only so `AppState` can be cloned cheaply
/// (it's an `Arc`); the bootstrap code in `server.rs` hands it to each
/// service constructor and then the field is never read again.
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
    pub payments: Arc<PaymentService>,
    pub chats: Arc<ChatService>,
    /// Recurring background jobs (admin cron-jobs page + scheduler).
    pub jobs: Arc<JobService>,
    /// Route picture gallery (upload / serve / GC) on the pluggable
    /// file-storage backends. The ONLY service that touches object
    /// storage.
    pub media: Arc<RouteMediaService>,
}

impl AppState {
    /// Construct the top-level `AppState` from the shared store + the
    /// pre-built services + RBAC checker. The `store` argument is kept
    /// here (as a private field) so the `Arc` refcount keeps the store
    /// alive for the lifetime of `AppState` — services hold their own
    /// `Arc` clones, but holding one here too makes the ownership
    /// graph obvious and survives any future service that might be
    /// constructed lazily.
    ///
    /// The arg count is intentional — this is the central composition
    /// root for the whole app, and adding a builder would just hide the
    /// dependency surface. Clippy's `too_many_arguments` lint is silenced
    /// here; it would fire on every new service addition otherwise.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        config: Arc<Config>,
        rbac: Arc<RbacChecker>,
        auth: Arc<AuthService>,
        posts: Arc<PostService>,
        users: Arc<UserService>,
        admin: Arc<AdminService>,
        reviews: Arc<ReviewService>,
        bookings: Arc<BookingService>,
        public: Arc<PublicService>,
        routing: Arc<RoutingService>,
        places: Arc<PlaceService>,
        price_alerts: Arc<PriceAlertService>,
        notifications: Arc<NotificationService>,
        wishlist: Arc<WishlistService>,
        payments: Arc<PaymentService>,
        chats: Arc<ChatService>,
        jobs: Arc<JobService>,
        media: Arc<RouteMediaService>,
    ) -> Self {
        Self {
            config,
            rbac,
            auth,
            posts,
            users,
            admin,
            reviews,
            bookings,
            public,
            routing,
            places,
            price_alerts,
            notifications,
            wishlist,
            payments,
            chats,
            jobs,
            media,
        }
    }
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

impl FromRef<AppState> for Arc<PaymentService> {
    fn from_ref(state: &AppState) -> Self {
        state.payments.clone()
    }
}

impl FromRef<AppState> for Arc<ChatService> {
    fn from_ref(state: &AppState) -> Self {
        state.chats.clone()
    }
}
