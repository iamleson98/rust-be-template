//! HTTP routes — axum handlers + utoipa OpenAPI annotations.

pub use self::router::build_router;
pub use self::openapi::ApiDoc;

mod auth;
mod bookings;
mod chat;
mod health;
mod openapi;
mod places;
mod posts;
mod price_alerts;
mod public;
mod reviews;
mod router;
mod routing;
mod users;
mod ws;
mod zeroclaw;
