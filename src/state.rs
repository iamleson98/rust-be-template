use std::sync::Arc;

use axum::extract::FromRef;

use crate::auth::csrf::CsrfManager;
use crate::auth::jwt::JwtManager;
use crate::auth::jwt_validator::JwtValidator;
use crate::auth::password::PasswordHasher;
use crate::auth::refresh::RefreshTokenManager;
use crate::cache::CacheBackend;
use crate::config::Config;
use crate::rbac::RbacChecker;
use crate::service::{AuthService, PostService, UserService};
use crate::store::Store;
use crate::ws::Hub;
use sea_orm::DatabaseConnection;

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
///   state that can supply a `JwtValidator`, not just `AppState`. This
///   makes it testable with a tiny mock state. See `middleware/auth_extractor.rs`.
#[derive(Clone)]
pub struct AppState {
    // ---- Shared infrastructure ----
    pub config: Arc<Config>,
    pub db: Arc<DatabaseConnection>,
    pub store: Arc<dyn Store>,
    pub cache: Arc<dyn CacheBackend>,
    pub rbac: Arc<RbacChecker>,
    pub jwt: Arc<JwtManager>,
    pub jwt_validator: Arc<JwtValidator>,
    pub refresh: Arc<RefreshTokenManager>,
    pub password: Arc<PasswordHasher>,
    pub csrf: Arc<CsrfManager>,
    pub ws_hub: Arc<Hub>,

    // ---- Domain services (pre-built, shared via Arc) ----
    pub auth: Arc<AuthService>,
    pub posts: Arc<PostService>,
    pub users: Arc<UserService>,
}

/// `Arc<JwtValidator>` is extractable from `AppState` via `FromRef`.
/// This lets the `AuthUser` extractor be generic over any state `S`
/// where `Arc<JwtValidator>: FromRef<S>`.
impl FromRef<AppState> for Arc<JwtValidator> {
    fn from_ref(state: &AppState) -> Self {
        state.jwt_validator.clone()
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
