//! Session user — the identity carried through the app after auth.
//!
//! The template's JWT only carries `sub: Uuid` (the user id) to keep the
//! access token small and avoid stale claims. When a richer identity is
//! needed (e.g. the WebSocket / audio-call hubs route by role + brand),
//! the `SessionUser` is loaded from the user store after JWT verification.
//!
//! This mirrors the `SessionUser` shape used by `booking-rs` so the ported
//! WS / audio-call / zeroclaw modules can consume it unchanged.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::entity::user;

/// Identity of an authenticated actor, derived from the `user` row.
///
/// `actor_type` is `"user"` for customers and `"employee"` for staff. The
/// distinction matters for the chat / call hubs (only employees may register
/// as agents) and for zeroclaw (human-fallback threshold counts online
/// employees).
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionUser {
    pub id: String,
    #[serde(rename = "type")]
    pub actor_type: String,
    pub role: String,
    pub name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub avatar_url: Option<String>,
    pub brand_id: Option<String>,
    pub brand_name: Option<String>,
    pub employee_role: Option<String>,
}

impl SessionUser {
    /// Build a `SessionUser` from a `user::Model`.
    ///
    /// `brand_name` is left `None` here — the caller (typically the auth
    /// service) fills it in via a brand lookup when the user has a brand.
    pub fn from_model(m: &user::Model) -> Self {
        // let actor_type = if m.role == "user" { "user" } else { "employee" };
        let employee_role = if m.role == "admin" {
            Some(m.role.clone())
        } else {
            None
        };
        Self {
            id: m.id.to_string(),
            actor_type: m.role.to_string(),
            role: m.role.clone(),
            name: m.full_name.clone(),
            email: Some(m.email.clone()),
            phone: Some(m.phone.clone()),
            avatar_url: m.avatar_url.clone(),
            brand_id: m.brand_id.clone(),
            brand_name: None,
            employee_role,
        }
    }

    /// Convenience: parse the `id` back to a `Uuid`.
    pub fn uuid(&self) -> Result<Uuid, uuid::Error> {
        Uuid::parse_str(&self.id)
    }

    /// Is this actor an employee (staff)?
    pub fn is_employee(&self) -> bool {
        self.actor_type == "employee"
    }
}
