//! WebSocket module — axum `ws` upgrade handler + in-memory connection hub.
//!
//! The hub (`hub.rs`) is a process-local singleton built on `DashMap` for
//! lock-free concurrent connection/room/presence tracking. The handler
//! (`handler.rs`) implements the socket.io-like message protocol the frontend
//! `socket.io-client` speaks (join/read/message/typing events with
//! client-message-id idempotency).
//!
//! ## Concurrency design (high-level)
//!
//! * **Bounded outbound channel** per session (`ws_channel_capacity`, default
//!   256) — a slow consumer fills its queue, then `try_send` drops further
//!   messages; the heartbeat sweep eventually reaps the socket. No unbounded
//!   memory growth per client.
//! * **Global connection cap** (`ws_max_connections`, default 50_000) —
//!   atomic admission check at upgrade time; over-cap upgrades get HTTP 503.
//! * **Server-initiated heartbeat** (`ws_heartbeat_sec`, default 30s) —
//!   Ping frames keep NAT bindings warm and probe for dead peers.
//! * **Idle timeout** (`ws_idle_timeout_sec`, default 90s) — half-open
//!   sockets (no frame received) are force-closed, freeing the slot.
//! * **Channel-exists cache** (moka, 60s TTL) — short-circuits the DB
//!   `SELECT` on every `join` re-entry.
//! * **Graceful drain** — on shutdown, every live socket receives a
//!   `system:shutdown` notice + Close frame before the process exits.

pub mod handler;
pub mod hub;

pub use handler::{drain_all_connections, router, spawn_idem_gc, spawn_metrics_logger};
pub use hub::{hub, ChatHub, ClientTx, HubStats, Session};
