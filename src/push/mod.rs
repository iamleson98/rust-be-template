//! Push hub — the process-global bridge between call signaling and
//! device push (FCM/APNs).
//!
//! "Ring even when the app is closed": the audio-call session manager
//! rings agents over the `/ws-call` WebSocket, which only works while
//! the app process is alive. This hub accelerates those rings with
//! FCM data messages (`incoming-call` / `call-ended`), which wake
//! backgrounded/frozen apps (Android high-priority data messages
//! bypass Doze) and are the only channel that reaches a force-stopped
//! app or an iOS app in the background (PushKit).
//!
//! ## Design
//!
//! * Process-global singleton (`OnceLock`) — same pattern as the
//!   presence registry and both WS hubs: the audio-call handlers run
//!   inside WS upgrade tasks with no `AppState` in scope.
//! * **Config-gated**: without `FCM_CREDENTIALS_JSON` every call is a
//!   cheap no-op (the Android foreground-service duty mode covers the
//!   closed-app case without Firebase; FCM is the belt-and-braces
//!   layer + the only iOS path).
//! * All sends are `tokio::spawn`ed fire-and-forget — push latency
//!   never blocks call setup, and a slow/failed FCM round trip can
//!   never stall the signaling path.
//! * Stale tokens self-prune: FCM 404/410 UNREGISTERED replies delete
//!   the device row.

pub mod fcm;

use std::sync::{Arc, OnceLock};

use sea_orm::DatabaseConnection;
use serde_json::json;

use crate::store::{DbPushDeviceStore, PushDeviceStore, StoreError};

use self::fcm::{FcmClient, FcmSendOutcome};

/// Process-global push hub.
pub struct PushHub {
    devices: Option<Arc<DbPushDeviceStore>>,
    fcm: Option<Arc<FcmClient>>,
}

static PUSH: OnceLock<PushHub> = OnceLock::new();

/// Initialise the hub at server boot (before any WS accepts).
///
/// `fcm_credentials_json` comes from `FCM_CREDENTIALS_JSON` (the full
/// Firebase service-account JSON). `None`/invalid → push disabled,
/// logged loudly exactly once.
pub fn init(db: Arc<DatabaseConnection>, fcm_credentials_json: Option<&str>) {
    let fcm = match fcm_credentials_json {
        None => {
            tracing::info!(
                "push: FCM_CREDENTIALS_JSON not set — device push disabled \
                 (WS ring + Android duty mode still cover backgrounded apps)"
            );
            None
        }
        Some(raw) if raw.trim().is_empty() => {
            tracing::info!("push: FCM_CREDENTIALS_JSON empty — device push disabled");
            None
        }
        Some(raw) => match FcmClient::from_credentials(raw) {
            Ok(c) => {
                tracing::info!("push: FCM enabled (project {})", c.project_id());
                Some(Arc::new(c))
            }
            Err(e) => {
                tracing::error!("push: FCM_CREDENTIALS_JSON invalid — push DISABLED: {e}");
                None
            }
        },
    };
    let _ = PUSH.set(PushHub {
        devices: Some(Arc::new(DbPushDeviceStore::new(db))),
        fcm,
    });
}

/// Process-global accessor (lazily initialised to a disabled hub if
/// `init` was never called — e.g. in unit tests: every notify call is
/// a no-op and register attempts error cleanly instead of panicking).
pub fn push() -> &'static PushHub {
    PUSH.get_or_init(|| PushHub {
        devices: None,
        fcm: None,
    })
}

impl PushHub {
    /// FCM transport is configured and the DB store is usable.
    pub fn is_enabled(&self) -> bool {
        self.fcm.is_some() && self.devices.is_some()
    }

    /// Register (upsert) a device token for a user.
    pub async fn register_device(
        &self,
        user_id: &str,
        token: &str,
        platform: &str,
    ) -> Result<crate::entity::push_device::Model, StoreError> {
        let devices = self
            .devices
            .as_ref()
            .ok_or_else(|| StoreError::Validation("push hub not initialised".into()))?;
        devices.upsert(user_id, token, platform).await
    }

    /// Remove one device token (logout / rotation).
    pub async fn unregister_device(&self, token: &str) -> Result<u64, StoreError> {
        let devices = self
            .devices
            .as_ref()
            .ok_or_else(|| StoreError::Validation("push hub not initialised".into()))?;
        devices.delete_by_token(token).await
    }

    /// Fire a data push to every registered device of an agent.
    /// Fire-and-forget; never blocks signaling.
    fn fanout(&self, agent_id: &str, data: serde_json::Value, collapse_key: &str) {
        let (Some(fcm), Some(devices)) = (self.fcm.clone(), self.devices.clone()) else {
            return;
        };
        let agent_id = agent_id.to_string();
        let collapse_key = collapse_key.to_string();
        tokio::spawn(async move {
            let rows = match devices.list_by_user(&agent_id).await {
                Ok(rows) => rows,
                Err(e) => {
                    tracing::warn!("push: device lookup for {agent_id} failed: {e}");
                    return;
                }
            };
            if rows.is_empty() {
                return;
            }
            let mut gone: Vec<String> = Vec::new();
            for row in rows {
                let outcome = fcm.send_data(&row.token, &data, &collapse_key).await;
                match outcome {
                    FcmSendOutcome::Sent => {}
                    FcmSendOutcome::Gone => gone.push(row.token),
                    FcmSendOutcome::Transient => {}
                }
            }
            for token in gone {
                if let Err(e) = devices.delete_by_token(&token).await {
                    tracing::warn!("push: prune stale token failed: {e}");
                }
            }
        });
    }

    /// Push an `incoming-call` wake-up for the agent being rung
    /// (called from `relay_offer` — initial ring AND every re-route
    /// ring; the shared `collapseKey` = call id keeps one ring per
    /// customer on each phone).
    pub fn notify_incoming_call(
        &self,
        agent_id: &str,
        customer_id: &str,
        channel_id: Option<&str>,
    ) {
        let data = json!({
            "type": "incoming-call",
            "customerId": customer_id,
            "channelId": channel_id,
        });
        let collapse = format!("call-{customer_id}");
        self.fanout(agent_id, data, &collapse);
    }

    /// Push `call-ended` so a phone still ringing from a ring that was
    /// re-routed away (or a call that ended) stops its ring UI.
    pub fn notify_call_ended(&self, agent_id: &str, customer_id: &str) {
        let data = json!({
            "type": "call-ended",
            "customerId": customer_id,
        });
        let collapse = format!("call-{customer_id}");
        self.fanout(agent_id, data, &collapse);
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn lazy_hub_without_init_is_disabled_noop() {
        // In unit tests `init` never ran → the lazily-created hub must
        // be a safe no-op, not a panic, for every notify path.
        let hub = crate::push::push();
        assert!(!hub.is_enabled());
        hub.notify_incoming_call("a1", "c1", Some("ch-1"));
        hub.notify_call_ended("a1", "c1");
    }
}
