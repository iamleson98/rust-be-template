//! HTTP routes — axum handlers + utoipa OpenAPI annotations.

pub use self::openapi::ApiDoc;
pub use self::router::build_router;

mod admin;
mod auth;
mod bookings;
mod chat;
mod health;
mod notifications;
mod oauth;
mod openapi;
mod payments;
mod places;
mod posts;
mod price_alerts;
mod public;
mod reviews;
mod router;
mod routing;
mod seo;
pub mod system;
mod users;
mod vitals;
mod wishlist;
mod zeroclaw;
