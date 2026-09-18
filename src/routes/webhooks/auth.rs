//! Webhook authenticity verification — MUST run before any platform
//! message is trusted.
//!
//! ## Why this module exists (SEC-2026-WH)
//!
//! All four platform webhooks (`/api/webhooks/{zalo,messenger,telegram,
//! discord}`) previously accepted requests with **no signature
//! verification**. Anyone on the internet could POST a forged platform
//! message, which `handle_platform_message` would then persist as a real
//! customer chat, create `platform:userid` user rows on demand, trigger
//! NullClaw AI replies (cost), and broadcast to the staff WebSocket.
//!
//! Each verifier below is **fail-closed**: if the platform's secret is
//! not configured, the request is REJECTED (401) with a loud log line.
//! Local development must set the env vars too — the README shows the
//! values to use for `docker compose` dev overrides.
//!
//! ## Platform schemes
//!
//! - Telegram:  constant-time compare of `X-Telegram-Bot-Api-Secret-Token`
//!   against `TELEGRAM_WEBHOOK_SECRET` (set the same value as the
//!   `secret_token` param of the `setWebhook` API call).
//! - Messenger: `X-Hub-Signature-256: sha256=<hex>` — HMAC-SHA256 over the
//!   RAW body bytes with `MESSENGER_APP_SECRET`; plus the GET subscription
//!   challenge must echo `MESSENGER_VERIFY_TOKEN`.
//! - Zalo OA:   `X-Zalo-Signature: <hex>` — HMAC-SHA256 over the RAW body
//!   bytes with `ZALO_OA_SECRET`.
//! - Discord:   Ed25519 signature over `<timestamp><raw body>` with the
//!   application's public key: headers `X-Signature-Ed25519` and
//!   `X-Signature-Timestamp`, key from `DISCORD_PUBLIC_KEY`.
//!
//! All comparisons are constant-time. HMAC comparisons additionally
//! verify over the raw body bytes exactly as received (handlers must use
//! the `axum::body::Bytes` extractor, never a JSON extractor, because
//! JSON re-serialization breaks the MAC).

use std::sync::OnceLock;

use axum::http::HeaderMap;
use constant_time_eq::constant_time_eq;
use hmac::{Hmac, Mac};
use sha2::Sha256;

use crate::error::AppError;

/// Env-provided webhook secrets, read once.
struct WebhookSecrets {
    telegram_secret: Option<String>,
    messenger_app_secret: Option<String>,
    messenger_verify_token: Option<String>,
    zalo_oa_secret: Option<String>,
    discord_public_key: Option<String>,
}

fn secrets() -> &'static WebhookSecrets {
    static SECRETS: OnceLock<WebhookSecrets> = OnceLock::new();
    SECRETS.get_or_init(|| WebhookSecrets {
        telegram_secret: std::env::var("TELEGRAM_WEBHOOK_SECRET")
            .ok()
            .filter(|s| !s.is_empty()),
        messenger_app_secret: std::env::var("MESSENGER_APP_SECRET")
            .ok()
            .filter(|s| !s.is_empty()),
        messenger_verify_token: std::env::var("MESSENGER_VERIFY_TOKEN")
            .ok()
            .filter(|s| !s.is_empty()),
        zalo_oa_secret: std::env::var("ZALO_OA_SECRET")
            .ok()
            .filter(|s| !s.is_empty()),
        discord_public_key: std::env::var("DISCORD_PUBLIC_KEY")
            .ok()
            .filter(|s| !s.is_empty()),
    })
}

fn reject(platform: &str, reason: &str) -> AppError {
    tracing::warn!(platform, reason, "webhook authenticity check FAILED");
    AppError::Unauthorized(format!("{platform} webhook rejected: {reason}"))
}

/// Telegram — `X-Telegram-Bot-Api-Secret-Token` constant-time compare.
pub fn verify_telegram(headers: &HeaderMap) -> Result<(), AppError> {
    let expected = secrets()
        .telegram_secret
        .as_deref()
        .ok_or_else(|| reject("telegram", "TELEGRAM_WEBHOOK_SECRET is not configured"))?;
    let provided = headers
        .get("x-telegram-bot-api-secret-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if constant_time_eq(expected.as_bytes(), provided.as_bytes()) {
        Ok(())
    } else {
        Err(reject("telegram", "invalid secret token"))
    }
}

/// Messenger GET subscription challenge — verify_token from config.
pub fn verify_messenger_challenge(token: &str) -> Result<(), AppError> {
    let expected = secrets()
        .messenger_verify_token
        .as_deref()
        .ok_or_else(|| reject("messenger", "MESSENGER_VERIFY_TOKEN is not configured"))?;
    if constant_time_eq(expected.as_bytes(), token.as_bytes()) {
        Ok(())
    } else {
        Err(reject("messenger", "invalid verify token"))
    }
}

/// Messenger POST — `X-Hub-Signature-256: sha256=<hex>` over raw body.
pub fn verify_messenger(headers: &HeaderMap, raw_body: &[u8]) -> Result<(), AppError> {
    let secret = secrets()
        .messenger_app_secret
        .as_deref()
        .ok_or_else(|| reject("messenger", "MESSENGER_APP_SECRET is not configured"))?;
    let provided = headers
        .get("x-hub-signature-256")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("sha256="))
        .unwrap_or("");
    let computed = hmac_sha256_hex(secret, raw_body);
    if constant_time_eq(computed.as_bytes(), provided.as_bytes()) {
        Ok(())
    } else {
        Err(reject("messenger", "invalid X-Hub-Signature-256"))
    }
}

/// Zalo OA — `X-Zalo-Signature: <hex>` HMAC-SHA256 over raw body.
pub fn verify_zalo(headers: &HeaderMap, raw_body: &[u8]) -> Result<(), AppError> {
    let secret = secrets()
        .zalo_oa_secret
        .as_deref()
        .ok_or_else(|| reject("zalo", "ZALO_OA_SECRET is not configured"))?;
    let provided = headers
        .get("x-zalo-signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .trim_start_matches("str=") // some Zalo payloads prefix with str=
        .to_ascii_lowercase();
    let computed = hmac_sha256_hex(secret, raw_body);
    if constant_time_eq(computed.as_bytes(), provided.as_bytes()) {
        Ok(())
    } else {
        Err(reject("zalo", "invalid X-Zalo-Signature"))
    }
}

/// Discord — Ed25519 over `<timestamp><raw body>` with the app public key.
///
/// Requires `ed25519-dalek = "2"` (see Cargo.toml patch). The signature
/// and public key are hex-encoded (64 and 32 bytes respectively).
pub fn verify_discord(headers: &HeaderMap, raw_body: &[u8]) -> Result<(), AppError> {
    let pk_hex = secrets()
        .discord_public_key
        .as_deref()
        .ok_or_else(|| reject("discord", "DISCORD_PUBLIC_KEY is not configured"))?;
    let sig_hex = headers
        .get("x-signature-ed25519")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let timestamp = headers
        .get("x-signature-timestamp")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let pk = hex::decode(pk_hex)
        .ok()
        .and_then(|v| <[u8; 32]>::try_from(v).ok())
        .ok_or_else(|| reject("discord", "public key must be 32 bytes of hex"))?;
    let sig = hex::decode(sig_hex)
        .ok()
        .and_then(|v| <[u8; 64]>::try_from(v).ok())
        .ok_or_else(|| reject("discord", "signature must be 64 bytes of hex"))?;

    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    let verifying_key =
        VerifyingKey::from_bytes(&pk).map_err(|_| reject("discord", "invalid public key bytes"))?;
    let signature =
        Signature::from_slice(&sig).map_err(|_| reject("discord", "invalid signature bytes"))?;

    // Signed message = timestamp bytes followed by the raw body.
    let mut message = timestamp.as_bytes().to_vec();
    message.extend_from_slice(raw_body);

    verifying_key
        .verify(&message, &signature)
        .map_err(|_| reject("discord", "Ed25519 signature mismatch"))
}

// ── helpers ──────────────────────────────────────────────────────

fn hmac_sha256_hex(secret: &str, data: &[u8]) -> String {
    let mut mac =
        Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC can take any key length");
    mac.update(data);
    hex::encode(mac.finalize().into_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hmac_helper_matches_known_vector() {
        // RFC 4231 test case 1 (HMAC-SHA256, key "key", data "The quick brown fox jumps over the lazy dog")
        assert_eq!(
            hmac_sha256_hex("key", b"The quick brown fox jumps over the lazy dog"),
            "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8"
        );
    }
}
