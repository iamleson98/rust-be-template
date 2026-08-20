//! Facebook OAuth 2.0 provider.
//!
//! ## Endpoints used
//!
//!   * Authorization URL:
//!     `https://www.facebook.com/v18.0/dialog/oauth`
//!   * Token exchange:
//!     `https://graph.facebook.com/v18.0/oauth/access_token`
//!   * Profile fetch:
//!     `https://graph.facebook.com/v18.0/me?fields=id,name,email,picture`
//!
//! ## Scopes
//!
//!   * `email` — required for the user's email.
//!   * `public_profile` — implicit; `id` + `name` come back automatically.

use async_trait::async_trait;
use serde::Deserialize;
use std::time::Duration;

use crate::auth::oauth::{OAuthProfile, OAuthProvider};
use crate::config::OAuthProviderConfig;
use crate::error::AppError;

const AUTH_URL: &str = "https://www.facebook.com/v18.0/dialog/oauth";
const TOKEN_URL: &str = "https://graph.facebook.com/v18.0/oauth/access_token";
const PROFILE_URL: &str = "https://graph.facebook.com/v18.0/me";

const DEFAULT_SCOPES: &str = "email public_profile";

pub struct FacebookProvider {
    client_id: String,
    client_secret: String,
    scopes: String,
    http: reqwest::Client,
}

impl FacebookProvider {
    /// Construct directly from the OAuth provider config block.
    /// Always returns an instance — `is_configured()` reports whether
    /// the credentials are actually set.
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
impl OAuthProvider for FacebookProvider {
    fn name(&self) -> &'static str {
        "facebook"
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
            "{AUTH_URL}?client_id={cid}&redirect_uri={ru}&state={st}&scope={sc}&response_type=code",
            cid = urlencoding::encode(&self.client_id),
            ru = urlencoding::encode(redirect_uri),
            st = urlencoding::encode(state),
            sc = urlencoding::encode(scopes),
        )
    }

    async fn exchange_code(
        &self,
        code: &str,
        redirect_uri: &str,
    ) -> Result<String, AppError> {
        let resp = self
            .http
            .post(TOKEN_URL)
            .query(&[
                ("client_id", self.client_id.as_str()),
                ("client_secret", self.client_secret.as_str()),
                ("redirect_uri", redirect_uri),
                ("code", code),
            ])
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("fb token exchange: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Internal(format!(
                "fb token exchange failed ({status}): {body}"
            )));
        }

        #[derive(Deserialize)]
        struct FbTokenResp {
            access_token: String,
        }
        let parsed: FbTokenResp = resp
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("fb token parse: {e}")))?;
        Ok(parsed.access_token)
    }

    async fn fetch_profile(&self, access_token: &str) -> Result<OAuthProfile, AppError> {
        let resp = self
            .http
            .get(PROFILE_URL)
            .query(&[
                ("fields", "id,name,email,picture"),
                ("access_token", access_token),
            ])
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("fb profile fetch: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Internal(format!(
                "fb profile fetch failed ({status}): {body}"
            )));
        }

        #[derive(Deserialize)]
        struct FbPictureData {
            url: Option<String>,
        }
        #[derive(Deserialize)]
        struct FbPicture {
            data: Option<FbPictureData>,
        }
        #[derive(Deserialize)]
        struct FbProfile {
            id: String,
            name: String,
            email: Option<String>,
            picture: Option<FbPicture>,
        }
        let p: FbProfile = resp
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("fb profile parse: {e}")))?;

        let email = p
            .email
            .ok_or_else(|| AppError::BadRequest("Facebook did not return an email".into()))?;

        Ok(OAuthProfile {
            provider: "facebook".into(),
            subject: p.id,
            email,
            name: p.name,
            avatar_url: p.picture.and_then(|x| x.data).and_then(|d| d.url),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_authorization_url() {
        let p = FacebookProvider::with_credentials(&OAuthProviderConfig {
            enabled: true,
            client_id: "123".into(),
            client_secret: "secret".into(),
            scopes: String::new(),
        });
        let url = p.authorization_url("xyz", "https://app.com/cb");
        assert!(url.contains("client_id=123"));
        assert!(url.contains("state=xyz"));
        assert!(url.contains("redirect_uri=https%3A%2F%2Fapp.com%2Fcb"));
        // `urlencoding::encode` uses %20 for spaces.
        assert!(
            url.contains("scope=email%20public_profile") || url.contains("scope=email"),
            "url = {url}"
        );
    }

    #[test]
    fn is_configured_requires_both_creds() {
        let p = FacebookProvider::with_credentials(&OAuthProviderConfig::default());
        assert!(!p.is_configured());
    }
}
