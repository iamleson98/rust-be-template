//! WebSocket upgrade route for the chat hub (`/ws`).
//!
//! Delegates to `ws::handler::router()` which builds the `/ws` route with
//! JWT auth, connection caps, and the socket.io-like message protocol.

// use axum::Router;

// use crate::state::AppState;

// /// The `/ws` chat WebSocket router, nested under `/api` by `routes::router`.
// pub fn router() -> Router<AppState> {
//     crate::ws::handler::router()
// }
