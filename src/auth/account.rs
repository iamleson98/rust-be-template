//! Values handed to the user store when an account is created or a
//! sign-in is recorded.

/// A new password account (`POST /api/auth/register`).
#[derive(Debug, Clone)]
pub struct NewAccount {
    pub full_name: String,
    /// The lower-cased address.
    pub email: Option<String>,
    /// The normalised phone number. At least one of the two is set; the
    /// unique `email` column holds the address, or for a phone-only signup
    /// the number.
    pub phone: Option<String>,
    pub password_hash: String,
    pub locale: String,
}

/// The support bot that is created together with the first admin.
#[derive(Debug, Clone)]
pub struct NewBot {
    pub email: String,
    pub full_name: String,
    pub password_hash: String,
}

/// A stored password hash to replace after a successful sign-in.
#[derive(Debug, Clone)]
pub struct PasswordRehash {
    /// The hash that was just verified; it is only replaced while it is
    /// still the stored one, so a password changed in the meantime is
    /// never overwritten.
    pub old: String,
    pub new: String,
}
