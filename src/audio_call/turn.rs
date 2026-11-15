//! Cloudflare Realtime TURN credentials (`AUDIO_CALL_TURN_AUTH_MODE=cloudflare`).
//!
//! Direct peer-to-peer audio fails behind symmetric NATs and corporate
//! firewalls that let only HTTPS out. Cloudflare's managed TURN relays
//! the media on `turns:…:443`, which needs no open port on our box:
//! the backend only asks Cloudflare's API for short-lived credentials
//! and hands them to the clients in the `registered` / `ice-servers`
//! frames (the same `iceServers` field every mode fills).
//!
//! ```text
//! POST https://rtc.live.cloudflare.com/v1/turn/keys/{TURN_KEY_ID}/credentials/generate-ice-servers
//! Authorization: Bearer {TURN_KEY_API_TOKEN}
//! {"ttl": N}
//! ```
//!
//! * One minting serves everyone: the result is cached until half its
//!   lifetime has passed, so a burst of registrations is one API call.
//! * Cloudflare being unreachable never takes calls down: credentials
//!   already minted keep being served (a live relay allocation outlives
//!   the blip), and with none, clients get public STUN — friendly
//!   networks still connect.
//! * The credentialed entry always lists every transport Cloudflare's
//!   TURN speaks, including the firewall-friendly TCP 443 / TLS 443 ones
//!   the API's own answer may leave out.

use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::Mutex;

use crate::config::AudioCallConfig;

/// Base of the Cloudflare Realtime TURN keys API.
pub const CLOUDFLARE_TURN_API: &str = "https://rtc.live.cloudflare.com/v1/turn/keys";

/// Smallest and largest credential lifetime asked for, in seconds.
const MIN_TTL_SEC: u64 = 600;
const MAX_TTL_SEC: u64 = 86_400;

/// How long minting may take before it counts as an outage. Clients wait
/// on it to register, so it stays short.
const API_TIMEOUT: Duration = Duration::from_secs(5);

/// Every transport Cloudflare's TURN listens on, from fast to
/// "gets through anything".
const TURN_URLS: [&str; 6] = [
    "turn:turn.cloudflare.com:3478?transport=udp",
    "turn:turn.cloudflare.com:443?transport=udp",
    "turn:turn.cloudflare.com:3478?transport=tcp",
    "turn:turn.cloudflare.com:80?transport=tcp",
    "turns:turn.cloudflare.com:5349?transport=tcp",
    "turns:turn.cloudflare.com:443?transport=tcp",
];

/// The `iceServers` of a client that has no TURN: public STUN only.
pub fn public_ice_servers() -> Vec<Value> {
    vec![
        json!({ "urls": ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }),
        json!({ "urls": ["stun:stun.cloudflare.com:3478"] }),
    ]
}

/// The API's answer, validated rather than trusted.
#[derive(Deserialize)]
struct ApiResponse {
    #[serde(rename = "iceServers")]
    ice_servers: Vec<ApiIceServer>,
}

#[derive(Deserialize)]
struct ApiIceServer {
    urls: OneOrMany,
    username: Option<String>,
    credential: Option<String>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum OneOrMany {
    One(String),
    Many(Vec<String>),
}

impl ApiIceServer {
    /// The entry as a client reads it. A credentialed TURN entry gains the
    /// transports the API left out.
    fn into_json(self) -> Value {
        let mut urls = match self.urls {
            OneOrMany::One(url) => vec![url],
            OneOrMany::Many(urls) => urls,
        };
        let is_turn = self.username.is_some()
            && urls.iter().any(|u| {
                u.get(..5).is_some_and(|p| p.eq_ignore_ascii_case("turn:"))
                    || u.get(..6).is_some_and(|p| p.eq_ignore_ascii_case("turns:"))
            });
        if is_turn {
            for url in TURN_URLS {
                if !urls.iter().any(|u| u == url) {
                    urls.push(url.to_string());
                }
            }
        }
        let mut server = json!({ "urls": urls });
        if let Some(username) = self.username {
            server["username"] = Value::String(username);
        }
        if let Some(credential) = self.credential {
            server["credential"] = Value::String(credential);
        }
        server
    }
}

/// Minted credentials and when to mint again.
struct Minted {
    servers: Vec<Value>,
    refresh_at: Instant,
}

/// A client of one Cloudflare TURN key.
pub struct CloudflareTurn {
    http: reqwest::Client,
    api_base: String,
    key_id: String,
    api_token: String,
    ttl_sec: u64,
    minted: Mutex<Option<Minted>>,
}

impl CloudflareTurn {
    /// `ttl_sec` is clamped to what Cloudflare accepts (10 minutes to a day).
    pub fn new(api_base: &str, key_id: &str, api_token: &str, ttl_sec: u64) -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(API_TIMEOUT)
                .build()
                .expect("reqwest client"),
            api_base: api_base.trim_end_matches('/').to_string(),
            key_id: key_id.to_string(),
            api_token: api_token.to_string(),
            ttl_sec: ttl_sec.clamp(MIN_TTL_SEC, MAX_TTL_SEC),
            minted: Mutex::new(None),
        }
    }

    /// What to hand a client: Cloudflare's TURN (with credentials) plus
    /// public STUN, or public STUN alone when no credentials can be had.
    pub async fn ice_servers(&self) -> Vec<Value> {
        let mut servers = self.turn_servers().await.unwrap_or_default();
        servers.extend(public_ice_servers());
        servers
    }

    /// The credentialed entries: the cached minting while it is fresh,
    /// else a new one; on failure the last minting, if there ever was one.
    async fn turn_servers(&self) -> Option<Vec<Value>> {
        // Held across the request: concurrent registrations wait for the
        // one minting instead of each making their own.
        let mut minted = self.minted.lock().await;
        if let Some(m) = minted.as_ref().filter(|m| m.refresh_at > Instant::now()) {
            return Some(m.servers.clone());
        }
        match self.mint().await {
            Ok(servers) => {
                *minted = Some(Minted {
                    servers: servers.clone(),
                    refresh_at: Instant::now() + Duration::from_secs(self.ttl_sec / 2),
                });
                Some(servers)
            }
            Err(error) => {
                tracing::warn!(
                    %error,
                    "Cloudflare TURN credentials unavailable — serving the last ones, else public STUN"
                );
                minted.as_ref().map(|m| m.servers.clone())
            }
        }
    }

    async fn mint(&self) -> Result<Vec<Value>, String> {
        let response = self
            .http
            .post(format!(
                "{}/{}/credentials/generate-ice-servers",
                self.api_base, self.key_id
            ))
            .bearer_auth(&self.api_token)
            .json(&json!({ "ttl": self.ttl_sec }))
            .send()
            .await
            .map_err(|e| e.without_url().to_string())?;
        let status = response.status();
        if !status.is_success() {
            return Err(format!("TURN API answered {status}"));
        }
        let parsed: ApiResponse = response
            .json()
            .await
            .map_err(|e| format!("TURN API answer unreadable: {}", e.without_url()))?;
        if parsed.ice_servers.is_empty() {
            return Err("TURN API returned no iceServers".into());
        }
        tracing::debug!(ttl = self.ttl_sec, "TURN credentials minted");
        Ok(parsed
            .ice_servers
            .into_iter()
            .map(ApiIceServer::into_json)
            .collect())
    }
}

static CLOUDFLARE: OnceLock<CloudflareTurn> = OnceLock::new();

/// Whether `cfg` asks for Cloudflare-minted credentials.
pub fn uses_cloudflare_turn(cfg: &AudioCallConfig) -> bool {
    cfg.turn_auth_mode == "cloudflare"
}

/// The `iceServers` for one user under whichever credential mode `cfg`
/// selects: Cloudflare-minted, REST-signed per user, or the static env
/// JSON.
pub async fn ice_servers_for(cfg: &AudioCallConfig, user_id: &str) -> Value {
    if uses_cloudflare_turn(cfg) {
        let turn = CLOUDFLARE.get_or_init(|| {
            CloudflareTurn::new(
                CLOUDFLARE_TURN_API,
                &cfg.turn_key_id,
                &cfg.turn_key_api_token,
                cfg.turn_cred_lifetime_sec(),
            )
        });
        return Value::Array(turn.ice_servers().await);
    }
    cfg.ice_servers_for(user_id)
}

/// Whether open sockets need fresh `iceServers` on a timer: minted
/// credentials expire, a static list does not.
pub fn credentials_expire(cfg: &AudioCallConfig) -> bool {
    uses_cloudflare_turn(cfg) || cfg.uses_rest_turn_auth()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::{Path, State};
    use axum::http::{HeaderMap, StatusCode};
    use axum::routing::post;
    use axum::{Json, Router};
    use std::sync::{Arc, Mutex as StdMutex};

    /// What the mock Cloudflare saw, and what it answers next.
    #[derive(Default)]
    struct Mock {
        requests: Vec<Captured>,
        answer: Option<Value>,
    }

    struct Captured {
        key_id: String,
        authorization: String,
        body: Value,
    }

    type Shared = Arc<StdMutex<Mock>>;

    async fn generate(
        State(mock): State<Shared>,
        Path(key_id): Path<String>,
        headers: HeaderMap,
        Json(body): Json<Value>,
    ) -> (StatusCode, Json<Value>) {
        let mut mock = mock.lock().unwrap();
        mock.requests.push(Captured {
            key_id,
            authorization: headers
                .get("authorization")
                .and_then(|v| v.to_str().ok())
                .unwrap_or_default()
                .to_string(),
            body,
        });
        match mock.answer.clone() {
            Some(answer) => (StatusCode::CREATED, Json(answer)),
            None => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "errors": [{ "message": "boom" }] })),
            ),
        }
    }

    /// A mock of `POST /v1/turn/keys/{id}/credentials/generate-ice-servers`
    /// on a local port; returns its base URL.
    async fn serve(mock: Shared) -> String {
        let app = Router::new()
            .route("/{key_id}/credentials/generate-ice-servers", post(generate))
            .with_state(mock);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{addr}")
    }

    /// What Cloudflare answers: its STUN, and TURN on only the standard ports.
    fn cloudflare_answer(username: &str) -> Value {
        json!({ "iceServers": [
            { "urls": ["stun:stun.cloudflare.com:3478"] },
            {
                "urls": [
                    "turn:turn.cloudflare.com:3478?transport=udp",
                    "turn:turn.cloudflare.com:3478?transport=tcp",
                    "turns:turn.cloudflare.com:5349?transport=tcp",
                ],
                "username": username,
                "credential": "secret",
            },
        ]})
    }

    async fn client(answer: Option<Value>, ttl: u64) -> (CloudflareTurn, Shared) {
        let mock: Shared = Arc::new(StdMutex::new(Mock {
            answer,
            ..Mock::default()
        }));
        let base = serve(mock.clone()).await;
        (CloudflareTurn::new(&base, "key-123", "tok", ttl), mock)
    }

    fn urls_of(server: &Value) -> Vec<&str> {
        server["urls"]
            .as_array()
            .unwrap()
            .iter()
            .map(|u| u.as_str().unwrap())
            .collect()
    }

    #[tokio::test]
    async fn credentials_come_from_the_keys_api_with_the_bearer_token_and_ttl() {
        let (turn, mock) = client(Some(cloudflare_answer("u1")), 3600).await;

        let servers = turn.ice_servers().await;

        let mock = mock.lock().unwrap();
        assert_eq!(mock.requests.len(), 1);
        assert_eq!(mock.requests[0].key_id, "key-123");
        assert_eq!(mock.requests[0].authorization, "Bearer tok");
        assert_eq!(mock.requests[0].body, json!({ "ttl": 3600 }));

        // Cloudflare's own entries first, then the public STUN fallbacks.
        let credentialed = &servers[1];
        assert_eq!(credentialed["username"], "u1");
        assert_eq!(credentialed["credential"], "secret");
        assert_eq!(servers.len(), 2 + public_ice_servers().len());
        assert_eq!(&servers[2..], public_ice_servers().as_slice());
    }

    #[tokio::test]
    async fn the_relay_list_always_has_the_firewall_friendly_transports() {
        let (turn, _mock) = client(Some(cloudflare_answer("u1")), 3600).await;

        let servers = turn.ice_servers().await;

        let urls = urls_of(&servers[1]);
        for wanted in TURN_URLS {
            assert!(urls.contains(&wanted), "missing {wanted} in {urls:?}");
        }
        assert!(urls.contains(&"turns:turn.cloudflare.com:443?transport=tcp"));
        let unique: std::collections::HashSet<_> = urls.iter().collect();
        assert_eq!(unique.len(), urls.len(), "no URL listed twice");
        // The STUN-only entry is left as Cloudflare sent it.
        assert_eq!(urls_of(&servers[0]), ["stun:stun.cloudflare.com:3478"]);
        assert!(servers[0].get("username").is_none());
    }

    #[tokio::test]
    async fn one_minting_serves_every_registration_until_half_the_lifetime() {
        let (turn, mock) = client(Some(cloudflare_answer("u1")), 3600).await;

        for _ in 0..5 {
            turn.ice_servers().await;
        }

        assert_eq!(mock.lock().unwrap().requests.len(), 1);
    }

    #[tokio::test]
    async fn expired_credentials_are_minted_again() {
        let (turn, mock) = client(Some(cloudflare_answer("first")), 3600).await;
        turn.ice_servers().await;
        mock.lock().unwrap().answer = Some(cloudflare_answer("second"));
        turn.minted.lock().await.as_mut().unwrap().refresh_at = Instant::now();

        let servers = turn.ice_servers().await;

        assert_eq!(servers[1]["username"], "second");
        assert_eq!(mock.lock().unwrap().requests.len(), 2);
    }

    #[tokio::test]
    async fn an_api_outage_keeps_serving_the_last_credentials() {
        let (turn, mock) = client(Some(cloudflare_answer("u1")), 3600).await;
        turn.ice_servers().await;
        mock.lock().unwrap().answer = None;
        turn.minted.lock().await.as_mut().unwrap().refresh_at = Instant::now();

        let servers = turn.ice_servers().await;

        assert_eq!(mock.lock().unwrap().requests.len(), 2, "it did try");
        assert_eq!(servers[1]["username"], "u1", "stale beats nothing");
    }

    #[tokio::test]
    async fn without_any_credentials_clients_get_public_stun_only() {
        let (turn, _mock) = client(None, 3600).await;
        assert_eq!(turn.ice_servers().await, public_ice_servers());

        let (empty, _mock) = client(Some(json!({ "iceServers": [] })), 3600).await;
        assert_eq!(empty.ice_servers().await, public_ice_servers());

        let (garbled, _mock) = client(Some(json!({ "unexpected": true })), 3600).await;
        assert_eq!(garbled.ice_servers().await, public_ice_servers());
    }

    #[tokio::test]
    async fn an_unreachable_api_is_an_outage_not_a_failure() {
        // Nothing listens on port 1.
        let turn = CloudflareTurn::new("http://127.0.0.1:1", "key", "tok", 3600);
        assert_eq!(turn.ice_servers().await, public_ice_servers());
    }

    #[tokio::test]
    async fn the_lifetime_asked_for_is_held_to_what_cloudflare_takes() {
        for (configured, asked) in [(60, 600), (3600, 3600), (1_000_000, 86_400)] {
            let (turn, mock) = client(Some(cloudflare_answer("u1")), configured).await;
            turn.ice_servers().await;
            assert_eq!(
                mock.lock().unwrap().requests[0].body["ttl"],
                asked,
                "configured {configured}s"
            );
        }
    }

    #[tokio::test]
    async fn the_other_modes_still_answer_from_the_config() {
        let cfg = AudioCallConfig {
            turn_auth_mode: "static".into(),
            ice_servers: r#"[{"urls":["turn:own.example:3478"],"username":"u","credential":"c"}]"#
                .into(),
            ..AudioCallConfig::default()
        };
        let servers = ice_servers_for(&cfg, "user-1").await;
        assert_eq!(servers[0]["urls"][0], "turn:own.example:3478");
        assert!(!credentials_expire(&cfg), "a static list never expires");

        let cloudflare = AudioCallConfig {
            turn_auth_mode: "cloudflare".into(),
            ..cfg
        };
        assert!(credentials_expire(&cloudflare));
    }
}
