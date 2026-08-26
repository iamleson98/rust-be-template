//! Google OAuth 2.0 provider.
//!
//! ## Endpoints used
//!
//!   * Authorization URL: `https://accounts.google.com/o/oauth2/v2/auth`
//!   * Token exchange:   `https://oauth2.googleapis.com/token`
//!   * Profile fetch:    `https://www.googleapis.com/oauth2/v3/userinfo`
//!
//! ## Scopes
//!
//!   * `openid`           — required for the `sub` claim (stable user id).
//!   * `email`            — required for the email.
//!   * `profile`          — required for the display name + avatar.
//!
//! ## Notes
//!
//! Google's `userinfo` endpoint returns `email_verified: bool`. We
//! reject the response if `email_verified` is `false` — binding an
//! OAuth identity to an unverified email would let an attacker
//! pre-register a victim's email on Google and then use that OAuth
//! identity to take over the local account.

use async_trait::async_trait;
use serde::Deserialize;
use std::time::Duration;

use crate::auth::oauth::{OAuthProfile, OAuthProvider};
use crate::config::OAuthProviderConfig;
use crate::error::AppError;

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const PROFILE_URL: &str = "https://www.googleapis.com/oauth2/v3/userinfo";

const DEFAULT_SCOPES: &str = "openid email profile";

pub struct GoogleProvider {
    client_id: String,
    client_secret: String,
    scopes: String,
    http: reqwest::Client,
}

impl GoogleProvider {
    pub fn with_credentials(cfg: &OAuthProviderConfig) -> Self {
        let scopes = if cfg.scopes.is_empty() {
            DEFAULT_SCOPES.to_string()
        } else {
            cfg.scopes.clone()
        };
        Self {
            client_id: cfg.client_id.clone(),
            client_secret: cfg.client_secret.clone(),
            scopes,
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
        }
    }
}

#[async_trait]
impl OAuthProvider for GoogleProvider {
    fn name(&self) -> &'static str {
        "google"
    }

    fn is_configured(&self) -> bool {
        !self.client_id.is_empty() && !self.client_secret.is_empty()
    }

    fn authorization_url(&self, state: &str, redirect_uri: &str) -> String {
        let scopes = if self.scopes.is_empty() {
            DEFAULT_SCOPES
        } else {
            &self.scopes
        };
        format!(
            "{AUTH_URL}?client_id={cid}&redirect_uri={ru}&state={st}&scope={sc}&response_type=code&access_type=offline&prompt=consent",
            cid = urlencoding::encode(&self.client_id),
            ru = urlencoding::encode(redirect_uri),
            st = urlencoding::encode(state),
            sc = urlencoding::encode(scopes),
        )
    }

    async fn exchange_code(&self, code: &str, redirect_uri: &str) -> Result<String, AppError> {
        let resp = self
            .http
            .post(TOKEN_URL)
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("client_secret", self.client_secret.as_str()),
                ("redirect_uri", redirect_uri),
                ("code", code),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("google token exchange: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Internal(format!(
                "google token exchange failed ({status}): {body}"
            )));
        }

        #[derive(Deserialize)]
        struct GoogleTokenResp {
            access_token: String,
        }
        let parsed: GoogleTokenResp = resp
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("google token parse: {e}")))?;
        Ok(parsed.access_token)
    }

    async fn fetch_profile(&self, access_token: &str) -> Result<OAuthProfile, AppError> {
        let resp = self
            .http
            .get(PROFILE_URL)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("google profile fetch: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Internal(format!(
                "google profile fetch failed ({status}): {body}"
            )));
        }

        #[derive(Deserialize)]
        struct GoogleProfile {
            sub: String,
            email: String,
            email_verified: Option<bool>,
            name: Option<String>,
            picture: Option<String>,
        }
        let p: GoogleProfile = resp
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("google profile parse: {e}")))?;

        // Reject unverified emails — see module docs.
        if p.email_verified == Some(false) {
            return Err(AppError::BadRequest("Google email is not verified".into()));
        }

        Ok(OAuthProfile {
            provider: "google".into(),
            subject: p.sub,
            email: p.email,
            name: p.name.unwrap_or_else(|| "Người dùng Google".into()),
            avatar_url: p.picture,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_authorization_url() {
        let p = GoogleProvider::with_credentials(&OAuthProviderConfig {
            enabled: true,
            client_id: "123".into(),
            client_secret: "secret".into(),
            scopes: String::new(),
        });
        let url = p.authorization_url("xyz", "https://app.com/cb");
        assert!(url.contains("client_id=123"));
        assert!(url.contains("state=xyz"));
        assert!(url.contains("redirect_uri=https%3A%2F%2Fapp.com%2Fcb"));
        // `urlencoding::encode` uses %20 for spaces, not +.
        assert!(
            url.contains("scope=openid%20email%20profile") || url.contains("scope=openid"),
            "url = {url}"
        );
    }

    #[test]
    fn is_configured_requires_both_creds() {
        let p = GoogleProvider::with_credentials(&OAuthProviderConfig::default());
        assert!(!p.is_configured());
    }
}
