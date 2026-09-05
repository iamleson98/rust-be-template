//! Session user — the identity carried through the app after auth.
//!
//! The template's JWT only carries `sub: Uuid` (the user id) to keep the
//! access token small and avoid stale claims. When a richer identity is
//! needed (e.g. the WebSocket / audio-call hubs route by role + brand),
//! the `SessionUser` is loaded from the user store after JWT verification.
//!
//! This mirrors the `SessionUser` shape used by `booking-rs` so the ported
//! WS / audio-call / nullclaw modules can consume it unchanged.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::entity::user;

/// Identity of an authenticated actor, derived from the `user` row.
///
/// `actor_type` mirrors the `user.role` column and is one of:
///   - `"user"`      — customer (book trips, feedback, ticket status)
///   - `"employee"`  — support staff (bookings, tickets, chat, calls, promos)
///   - `"admin"`     — full-access superuser (the first registered account)
///
/// The distinction matters for the chat / call hubs (only staff — employees
/// OR admins — may register as agents) and for nullclaw (the human-fallback
/// threshold counts online staff).
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionUser {
    pub id: Uuid,
    #[serde(rename = "type")]
    pub actor_type: String,
    pub role: String,
    pub name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub avatar_url: Option<String>,
    pub brand_id: Option<Uuid>,
    pub brand_name: Option<String>,
    pub employee_role: Option<String>,
}

impl SessionUser {
    /// Build a `SessionUser` from a `user::Model`.
    ///
    /// `brand_name` is left `None` here — the caller (typically the auth
    /// service) fills it in via a brand lookup when the user has a brand.
    pub fn from_model(m: &user::Model) -> Self {
        let employee_role = if m.role == "employee" || m.role == "admin" {
            Some(m.role.clone())
        } else {
            None
        };
        Self {
            id: m.id,
            actor_type: m.role.to_string(),
            role: m.role.clone(),
            name: m.full_name.clone(),
            email: Some(m.email.clone()),
            phone: m.phone.clone(),
            avatar_url: m.avatar_url.clone(),
            brand_id: m.brand_id,
            brand_name: None,
            employee_role,
        }
    }

    /// Is this actor a strict-role employee (not an admin)?
    pub fn is_employee(&self) -> bool {
        self.actor_type == "employee"
    }

    /// Is this actor staff — an employee OR an admin?
    ///
    /// This is the check the hubs / chat routing / agent registration
    /// should use: admins are full support agents too (they see every
    /// channel, receive chat + call routing, and count toward the
    /// "human online" presence signal that disables the NullClaw bot).
    pub fn is_staff(&self) -> bool {
        self.actor_type == "employee" || self.actor_type == "admin"
    }

    /// Is this actor an admin (full permissions)?
    pub fn is_admin(&self) -> bool {
        self.actor_type == "admin"
    }
}
