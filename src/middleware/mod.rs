//! HTTP middleware: rate limiting, auth extractors, request-id, timeout.
//!
//! Note: permission checks happen at the service layer (each service's
//! methods call `rbac.require(user_id, PERMISSION)`); there is no
//! dedicated middleware layer for permission enforcement.

pub use self::auth_extractor::{AdminUser, AuthUser, MaybeAuthUser};
pub use self::request_id::RequestId;
pub use self::timeout::request_timeout;

pub mod auth_extractor;
pub mod request_id;
pub mod timeout;
