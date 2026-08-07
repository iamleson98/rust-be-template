//! In-process WebSocket hub.
//!
//! `Hub` holds all live connections keyed by `UserId`. Channels broadcast
//! to all subscribers of a topic; topic membership is tracked per-user so
//! a future Redis-backed fan-out implementation can swap in without
//! changing the public API.
//!
//! Designed to be extended: replace `Hub` with a Redis-backed fan-out
//! variant later and call sites stay the same.

pub use self::hub::Hub;
pub use self::handler::run_socket as ws_handler;

mod hub;
mod handler;
