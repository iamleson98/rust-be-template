use std::sync::Arc;

use axum::extract::FromRef;

use crate::config::Config;
use crate::service::{AuthService, PostService, UserService};
use crate::store::Store;
use crate::ws::Hub;

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
/// - **`AuthUser` extractor is generic via `FromRef`** — works with any
///   state that can supply an `AuthService`, not just `AppState`.
///   This keeps middleware independent of the concrete app state type.
#[derive(Clone)]
pub struct AppState {
    // ---- Shared infrastructure ----
    pub config: Arc<Config>,
    pub store: Arc<dyn Store>,
    pub ws_hub: Arc<Hub>,

    // ---- Domain services (pre-built, shared via Arc) ----
    pub auth: Arc<AuthService>,
    pub posts: Arc<PostService>,
    pub users: Arc<UserService>,
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
