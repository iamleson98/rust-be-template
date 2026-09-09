//! WebRTC audio-call signaling — native Rust implementation.
//!
//! Replaces the old Bun mini-service (`mini-services/audio-call-service/`,
//! now deleted). Same wire protocol, but:
//!
//! * lives inside the existing axum backend on `:8080` (no extra process,
//!   no extra port, no Node runtime);
//! * authenticates the WS upgrade with the same JWT used by `/ws` — the
//!   `userId` claim is taken from the token, NOT from the client payload
//!   (so a malicious client can't impersonate another user);
//! * enforces RBAC on `register`: only `actor_type == "employee"` may
//!   register as an agent;
//! * reuses the same bounded-channel + heartbeat + idle-timeout pattern
//!   as the chat WS (`ws/handler.rs`), so a slow consumer or a
//!   half-open socket is reaped without leaking memory;
//! * runs on the same tuned multi-threaded Tokio runtime as the rest
//!   of the backend — no separate event loop, no Node-Bun FFI boundary.
//!
//! ## Why NOT `webrtc-rs`?
//!
//! For 1-1 browser calls the server is **only a signaling relay** —
//! the actual audio flows peer-to-peer over `RTCPeerConnection`. The
//! `webrtc-rs` crate is a full WebRTC *stack* (ICE/DTLS/SRTP/RTP),
//! only needed when the server itself is a peer (SFU/MCU/recording).
//! Pulling it in here would add ~30 ssn crates and ~3 MiB to the binary
//! for zero benefit. axum's built-in `ws` feature is all we need.
//!
//! ## Wire protocol (JSON, one message per WS text frame)
//!
//! Client → Server:
//! ```jsonc
//! { "type": "register",  "role": "customer" | "agent", "channelId"? }
//! { "type": "call",      "to": "agent" | userId, "kind": "offer" | "answer" | "ice",
//!                        "sdp"?: RTCSessionDescriptionInit, "candidate"?: RTCIceCandidateInit }
//! { "type": "hangup",    "to": userId }
//! { "type": "heartbeat" }
//! ```
//!
//! Server → Client:
//! ```jsonc
//! { "type": "registered", "role", "userId", "onlineAgents": N, "iceServers": [...] }
//! { "type": "incoming",   "from": userId, "channelId"?, "sdp", "kind": "offer" }
//! { "type": "answer",     "from": userId, "sdp" }
//! { "type": "ice",        "from": userId, "candidate" }
//! { "type": "hangup",     "from": userId, "reason": "remote" | "busy" | "declined" | "timeout" | "agent-offline" | "replaced" }
//! { "type": "presence",   "onlineAgents": N }
//! { "type": "error",      "code", "message" }
//! { "type": "pong" }
//! ```
//!
//! `registered.iceServers` carries the STUN/TURN config from
//! `AUDIO_CALL_ICE_SERVERS` (may be `[]` → client falls back to its default
//! public STUN list). Client→server `hangup` may include an optional
//! `reason` (`"busy"` | `"declined"` | `"timeout"`); anything else is
//! coerced to `"remote"` before relay.
//!
//! The `userId` field on outbound messages is the JWT-derived id, so the
//! peer can trust it (vs. the old Bun service which trusted the client).
//!
//! ## Endpoint
//!
//! `GET /ws-call?token=<jwt>` — axum WS upgrade. Mounted in `main.rs`
//! alongside `/ws`. Frontend connects via the Caddy gateway:
//! `wss://<host>/ws-call?XTransformPort=8080&token=<jwt>`.

pub mod handler;
pub mod hub;
pub mod session;

pub use handler::router;
pub use hub::{call_hub, CallHub};
pub use session::{sessions, CallSession, CallState, SessionManager};
