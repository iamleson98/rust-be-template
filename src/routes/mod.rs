//! HTTP routes — axum handlers + utoipa OpenAPI annotations.

pub use self::openapi::ApiDoc;
pub use self::router::build_router;

mod admin;
mod auth;
mod bookings;
mod chat;
mod health;
mod media;
mod notifications;
mod nullclaw;
mod oauth;
mod openapi;
mod payments;
mod places;
mod posts;
mod presence;
mod price_alerts;
mod public;
mod push_devices;
mod reviews;
mod router;
mod routing;
mod seo;
pub mod system;
mod users;
mod vitals;
mod webhooks;
mod wishlist;
