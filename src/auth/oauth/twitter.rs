//! X (Twitter) OAuth 2.0 provider.
//!
//! ## Endpoints used
//!
//!   * Authorization URL: `https://twitter.com/i/oauth2/authorize`
//!   * Token exchange:    `https://api.twitter.com/2/oauth2/token`
//!   * Profile fetch:     `https://api.twitter.com/2/users/me`
//!
//! ## Scopes
//!
//!   * `users.read`   — required to fetch the user profile.
//!   * `tweet.read`   — required by `users.read` (Twitter's quirk).
//!   * `offline.access` — required for refresh tokens.
//!
//! ## PKCE
//!
//! Twitter OAuth 2.0 *requires* PKCE (Proof Key for Code Exchange).
//! The `code_verifier` is generated in the `start` handler, stored in
//! a cookie alongside the state, and sent to the token endpoint as
//! `code_verifier`. The `code_challenge` (S256-hashed `code_verifier`)
//! is included in the authorization URL.
//!
//! Since PKCE requires the original `code_verifier` to be presented
//! at token exchange time, we encode it together with the state into
//! the same cookie. The `start` handler builds the URL; the `callback`
//! handler reads the cookie, decodes the verifier, and passes it to
//! `exchange_code`.

use async_trait::async_trait;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::time::Duration;

use crate::auth::oauth::{OAuthProfile, OAuthProvider};
use crate::config::OAuthProviderConfig;
use crate::error::AppError;

const AUTH_URL: &str = "https://twitter.com/i/oauth2/authorize";
const TOKEN_URL: &str = "https://api.twitter.com/2/oauth2/token";
const PROFILE_URL: &str = "https://api.twitter.com/2/users/me";

const DEFAULT_SCOPES: &str = "users.read tweet.read offline.access";

pub struct TwitterProvider {
    client_id: String,
    client_secret: String,
    scopes: String,
    http: reqwest::Client,
}

impl TwitterProvider {
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

impl TwitterProvider {
    /// Generate a random PKCE code_verifier (43-128 chars, base64-url).
    pub fn generate_code_verifier() -> String {
        use rand::RngCore;
        let mut bytes = [0u8; 48];
        rand::thread_rng().fill_bytes(&mut bytes);
        use_base64_url(&bytes)
    }

    /// Compute the S256 code_challenge for a given code_verifier.
    pub fn code_challenge(verifier: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(verifier.as_bytes());
        use_base64_url(&hasher.finalize())
    }
}

#[async_trait]
impl OAuthProvider for TwitterProvider {
    fn name(&self) -> &'static str {
        "twitter"
    }

    fn is_configured(&self) -> bool {
        !self.client_id.is_empty() && !self.client_secret.is_empty()
    }

    /// Build the Twitter authorization URL. Twitter requires PKCE —
    /// the `code_challenge` is the S256 hash of a `code_verifier` that
    /// the caller must remember (typically stored alongside the state
    /// in a short-lived cookie).
    ///
    /// `state` here is `{state}|{code_verifier}` — the caller splits
    /// on `|` to recover the verifier. We use this trick so the
    /// generic OAuth route handler doesn't need a Twitter-specific
    /// cookie slot.
    fn authorization_url(&self, state: &str, redirect_uri: &str) -> String {
        let scopes = if self.scopes.is_empty() {
            DEFAULT_SCOPES
        } else {
            &self.scopes
        };
        let (state_only, code_verifier) = split_state(state);
        let challenge = Self::code_challenge(&code_verifier);
        format!(
            "{AUTH_URL}?client_id={cid}&redirect_uri={ru}&state={st}&scope={sc}&response_type=code&code_challenge={cc}&code_challenge_method=S256",
            cid = urlencoding::encode(&self.client_id),
            ru = urlencoding::encode(redirect_uri),
            st = urlencoding::encode(&state_only),
            sc = urlencoding::encode(scopes),
            cc = urlencoding::encode(&challenge),
        )
    }

    async fn exchange_code(&self, code: &str, redirect_uri: &str) -> Result<String, AppError> {
        // The caller encodes the code_verifier into `redirect_uri`'s
        // fragment? No — the caller passes the original state (which
        // contains the verifier) via the SECOND parameter. We extract
        // it from there.
        // ── Actually: the route handler passes `code_verifier` via the
        // redirect_uri slot is bad. Let me redefine: the route handler
        // calls a Twitter-specific method `exchange_code_with_verifier`.
        // ── But the trait method signature is fixed. Compromise: encode
        // the verifier as `redirect_uri#verifier=...` and split here.
        let (real_redirect, code_verifier) = split_redirect(redirect_uri);

        let resp = self
            .http
            .post(TOKEN_URL)
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("client_secret", self.client_secret.as_str()),
                ("redirect_uri", real_redirect.as_str()),
                ("code", code),
                ("grant_type", "authorization_code"),
                ("code_verifier", code_verifier.as_str()),
            ])
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("twitter token exchange: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Internal(format!(
                "twitter token exchange failed ({status}): {body}"
            )));
        }

        #[derive(Deserialize)]
        struct TwitterTokenResp {
            access_token: String,
        }
        let parsed: TwitterTokenResp = resp
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("twitter token parse: {e}")))?;
        Ok(parsed.access_token)
    }

    async fn fetch_profile(&self, access_token: &str) -> Result<OAuthProfile, AppError> {
        let resp = self
            .http
            .get(PROFILE_URL)
            .bearer_auth(access_token)
            .query(&[("user.fields", "id,name,username,profile_image_url")])
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("twitter profile fetch: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Internal(format!(
                "twitter profile fetch failed ({status}): {body}"
            )));
        }

        #[derive(Deserialize)]
        struct TwitterData {
            id: String,
            name: Option<String>,
            username: String,
            profile_image_url: Option<String>,
        }
        #[derive(Deserialize)]
        struct TwitterProfile {
            data: TwitterData,
        }
        let p: TwitterProfile = resp
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("twitter profile parse: {e}")))?;

        // Twitter doesn't return an email even with the email scope
        // (the scope exists but is gated behind elevated access).
        // We synthesise a placeholder email from the username so the
        // local user record can still be created. The user can update
        // their email later via the profile page.
        let display_name = p.data.name.unwrap_or_else(|| p.data.username.clone());
        let email = format!("{}@twitter.local", p.data.username);

        Ok(OAuthProfile {
            provider: "twitter".into(),
            subject: p.data.id,
            email,
            name: display_name,
            avatar_url: p.data.profile_image_url,
        })
    }
}

/// Split the state into `(state, code_verifier)`. If the state was
/// composed as `{state}|{verifier}`, returns both parts. Otherwise
/// returns `(state, "")` — which will cause the token exchange to
/// fail at Twitter's end (this is intentional — PKCE is mandatory).
fn split_state(state: &str) -> (String, String) {
    if let Some(idx) = state.find('|') {
        (state[..idx].to_string(), state[idx + 1..].to_string())
    } else {
        (state.to_string(), String::new())
    }
}

/// The route handler encodes the code_verifier into the redirect_uri
/// via a `#verifier=` fragment. This fn splits it back out.
fn split_redirect(redirect_uri: &str) -> (String, String) {
    if let Some(idx) = redirect_uri.find("#verifier=") {
        (
            redirect_uri[..idx].to_string(),
            redirect_uri[idx + "#verifier=".len()..].to_string(),
        )
    } else {
        (redirect_uri.to_string(), String::new())
    }
}

fn use_base64_url(bytes: &[u8]) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_authorization_url_with_pkce() {
        let p = TwitterProvider::with_credentials(&OAuthProviderConfig {
            enabled: true,
            client_id: "123".into(),
            client_secret: "secret".into(),
            scopes: String::new(),
        });
        let verifier = "abc123verifier";
        let state = format!("mystate|{verifier}");
        let url = p.authorization_url(&state, "https://app.com/cb");
        assert!(url.contains("client_id=123"));
        assert!(url.contains("state=mystate"));
        assert!(url.contains("code_challenge_method=S256"));
        let challenge = TwitterProvider::code_challenge(verifier);
        assert!(url.contains(&format!(
            "code_challenge={}",
            urlencoding::encode(&challenge)
        )));
    }

    #[test]
    fn code_challenge_is_stable() {
        let v = "test-verifier";
        let c1 = TwitterProvider::code_challenge(v);
        let c2 = TwitterProvider::code_challenge(v);
        assert_eq!(c1, c2);
        assert!(!c1.is_empty());
    }

    #[test]
    fn is_configured_requires_both_creds() {
        let p = TwitterProvider::with_credentials(&OAuthProviderConfig::default());
        assert!(!p.is_configured());
    }

    #[test]
    fn split_redirect_extracts_verifier() {
        let (r, v) = split_redirect("https://app.com/cb#verifier=hello");
        assert_eq!(r, "https://app.com/cb");
        assert_eq!(v, "hello");
    }
}
