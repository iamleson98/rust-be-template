use argon2::password_hash::{
    rand_core::OsRng, PasswordHash, PasswordHasher as _, PasswordVerifier as _, SaltString,
};
use argon2::Argon2;

/// Wrapper around `argon2` for hashing and verifying passwords.
#[derive(Clone, Default)]
pub struct PasswordHasher;

impl PasswordHasher {
    pub fn new() -> Self {
        Self
    }

    pub fn hash(&self, password: &str) -> anyhow::Result<String> {
        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();
        let hash = argon2
            .hash_password(password.as_bytes(), &salt)
            .map_err(|e| anyhow::anyhow!("hash: {e}"))?;
        Ok(hash.to_string())
    }

    pub fn verify(&self, password: &str, hash: &str) -> bool {
        let parsed = match PasswordHash::new(hash) {
            Ok(h) => h,
            Err(_) => return false,
        };
        Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok()
    }
}
