//! HTTP routes — axum handlers + utoipa OpenAPI annotations.

pub use self::router::build_router;
pub use self::openapi::ApiDoc;

mod auth;
mod health;
mod openapi;
mod posts;
mod router;
mod users;
mod ws;
