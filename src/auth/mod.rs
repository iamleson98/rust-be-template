//! Auth: password hashing, JWT access tokens, rotating refresh tokens,
//! HttpOnly cookies, and CSRF (double-submit cookie pattern).

pub mod cookies;
pub mod csrf;
pub mod jwt;
pub mod jwt_validator;
pub mod password;
pub mod refresh;

pub use self::cookies::{clear_auth_cookies, set_auth_cookies};
pub use self::csrf::{CsrfError, CsrfManager};
pub use self::jwt::{AccessTokenClaims, JwtManager};
pub use self::jwt_validator::JwtValidator;
pub use self::password::PasswordHasher;
pub use self::refresh::{RefreshTokenManager, RefreshTokenValue};
