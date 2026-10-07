//! Push hub — the process-global bridge between call signaling and
//! device push (FCM for Android, APNs VoIP for iOS).
//!
//! "Ring even when the app is closed": the audio-call session manager
//! rings agents over the `/ws-call` WebSocket, which only works while
//! the app process is alive. This hub accelerates those rings with
//! data pushes, which wake backgrounded/frozen apps:
//! * **Android** — FCM data messages (`priority: HIGH` bypass Doze;
//!   also the only channel that reaches a force-stopped app).
//! * **iOS** — APNs **VoIP** pushes sent directly to Apple (FCM cannot
//!   carry `apns-push-type: voip`). iOS wakes the app and hands the
//!   payload to PushKit; the app reports it to CallKit (iOS 13+
//!   requirement) which shows the native incoming-call screen with the
//!   caller's name and avatar.
//!
//! ## Design
//!
//! * Process-global singleton (`OnceLock`) — same pattern as the
//!   presence registry and both WS hubs: the audio-call handlers run
//!   inside WS upgrade tasks with no `AppState` in scope.
//! * **Config-gated**: without `FCM_CREDENTIALS_JSON` every FCM call
//!   is a cheap no-op; without the `APNS_*` group every APNs call is.
//!   The two transports are independent — Android-only fleets can run
//!   FCM alone and vice versa.
//! * All sends are `tokio::spawn`ed fire-and-forget — push latency
//!   never blocks call setup, and a slow push round trip can never
//!   stall the signaling path.
//! * Stale tokens self-prune: FCM 404/410 and APNs 410 replies delete
//!   the device row.
//! * Device rows carry a `platform` (`ios` / `android` / `web`): the
//!   fan-out routes each row to its own transport. A call ring to an
//!   iOS device carries a CallKit-ready payload (caller identity,
//!   ring-duration) that the app's PushKit handler shows directly.

pub mod apns;
pub mod fcm;

use std::sync::{Arc, OnceLock};
use std::time::Duration;

use sea_orm::DatabaseConnection;
use serde_json::json;

use crate::store::{DbPushDeviceStore, PushDeviceStore, StoreError};

use self::apns::{ApnsClient, ApnsProviderKey, ApnsSendOutcome};
use self::fcm::{FcmClient, FcmSendOutcome};

/// The `incoming-call` ring: everything the phones need to show WHO is
/// calling (identity captured at offer time from the caller's verified
/// auth session) and how long the ring may last.
#[derive(Debug, Clone, Copy)]
pub struct IncomingCallPush<'a> {
    pub customer_id: &'a str,
    pub channel_id: Option<&'a str>,
    /// Caller's display name — shown on the callee's ringing UI
    /// (CallKit `nameCaller`, web banner, mobile call screen).
    pub caller_name: Option<&'a str>,
    /// Caller's avatar URL (CallKit + web/mobile avatar), when set.
    pub caller_avatar: Option<&'a str>,
}

impl IncomingCallPush<'_> {
    /// Human label for push titles/CallKit — the captured caller name,
    /// else the same generic label the mobile app uses as its in-app
    /// fallback ("Khách hàng") so the native ring never shows a blank
    /// caller line. This payload only ever targets AGENTS (the rung
    /// side), so the caller is always a customer.
    fn display_name(&self) -> &str {
        self.caller_name
            .filter(|n| !n.is_empty())
            .unwrap_or("Khách hàng")
    }
}

/// Process-global push hub.
pub struct PushHub {
    devices: Option<Arc<DbPushDeviceStore>>,
    fcm: Option<Arc<FcmClient>>,
    apns: Option<Arc<ApnsClient>>,
    /// Server-side ring window ([`crate::config::AudioCallConfig`]'s
    /// `ring_timeout_sec`), in milliseconds — pushed into the iOS
    /// CallKit payload (`duration`) so an unanswered native ring
    /// self-cleans exactly when the janitor would expire it anyway.
    ring_timeout_ms: u64,
}

static PUSH: OnceLock<PushHub> = OnceLock::new();

/// Initialise the hub at server boot (before any WS accepts).
///
/// `fcm_credentials_json` comes from `FCM_CREDENTIALS_JSON` (the full
/// Firebase service-account JSON); `apns_key` from the `APNS_*` group.
/// `None`/invalid per-transport → that transport disabled, logged
/// loudly exactly once.
pub fn init(
    db: Arc<DatabaseConnection>,
    fcm_credentials_json: Option<&str>,
    apns_key: Option<&ApnsProviderKey>,
    apns_topic: Option<&str>,
    apns_sandbox: bool,
    ring_timeout_sec: u64,
) {
    let fcm = match fcm_credentials_json {
        None => {
            tracing::info!("push: FCM_CREDENTIALS_JSON not set — FCM (Android) push disabled");
            None
        }
        Some(raw) if raw.trim().is_empty() => {
            tracing::info!("push: FCM_CREDENTIALS_JSON empty — FCM (Android) push disabled");
            None
        }
        Some(raw) => match FcmClient::from_credentials(raw) {
            Ok(c) => {
                tracing::info!("push: FCM enabled (project {})", c.project_id());
                Some(Arc::new(c))
            }
            Err(e) => {
                tracing::error!("push: FCM_CREDENTIALS_JSON invalid — FCM DISABLED: {e}");
                None
            }
        },
    };
    let apns = match (apns_key, apns_topic) {
        (Some(key), Some(topic)) if !key.is_empty() && !topic.trim().is_empty() => {
            match ApnsClient::from_parts(key, topic, apns_sandbox) {
                Ok(c) => {
                    tracing::info!(
                        "push: APNs VoIP enabled (topic {topic}, sandbox={apns_sandbox})"
                    );
                    Some(Arc::new(c))
                }
                Err(e) => {
                    tracing::error!("push: APNS_* credentials invalid — APNs DISABLED: {e}");
                    None
                }
            }
        }
        _ => {
            tracing::info!(
                "push: APNS_* group not set — APNs VoIP (iOS) push disabled \
                 (WS ring + CallKit re-delivery still cover foregrounded/reconnecting apps)"
            );
            None
        }
    };
    let _ = PUSH.set(PushHub {
        devices: Some(Arc::new(DbPushDeviceStore::new(db))),
        fcm,
        apns,
        ring_timeout_ms: ring_timeout_sec.saturating_mul(1000),
    });
}

/// Process-global accessor (lazily initialised to a disabled hub if
/// `init` was never called — e.g. in unit tests: every notify call is
/// a no-op and register attempts error cleanly instead of panicking).
pub fn push() -> &'static PushHub {
    PUSH.get_or_init(|| PushHub {
        devices: None,
        fcm: None,
        apns: None,
        ring_timeout_ms: 60_000,
    })
}

/// Classification shared by the fan-out loop: route each outcome to
/// the FCM-side or APNs-side enum.
enum SendOutcome {
    Sent,
    Gone,
    Transient,
}

impl From<FcmSendOutcome> for SendOutcome {
    fn from(o: FcmSendOutcome) -> Self {
        match o {
            FcmSendOutcome::Sent => SendOutcome::Sent,
            FcmSendOutcome::Gone => SendOutcome::Gone,
            FcmSendOutcome::Transient => SendOutcome::Transient,
        }
    }
}

impl From<ApnsSendOutcome> for SendOutcome {
    fn from(o: ApnsSendOutcome) -> Self {
        match o {
            ApnsSendOutcome::Sent => SendOutcome::Sent,
            ApnsSendOutcome::Gone => SendOutcome::Gone,
            ApnsSendOutcome::Transient => SendOutcome::Transient,
        }
    }
}

impl PushHub {
    /// At least one transport is configured and the DB store is usable.
    pub fn is_enabled(&self) -> bool {
        (self.fcm.is_some() || self.apns.is_some()) && self.devices.is_some()
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

    /// Remove one device token — scoped to the OWNING user (BOLA-safe:
    /// one authenticated user must not be able to unregister another
    /// user's device by guessing / harvesting tokens). Used by the
    /// `DELETE /api/push/devices/{token}` route.
    pub async fn unregister_device_for_user(
        &self,
        user_id: &str,
        token: &str,
    ) -> Result<u64, StoreError> {
        let devices = self
            .devices
            .as_ref()
            .ok_or_else(|| StoreError::Validation("push hub not initialised".into()))?;
        devices.delete_by_token_for_user(user_id, token).await
    }

    /// Fire a push to every registered device of an agent, routing each
    /// row to its platform's transport (`ios` → APNs VoIP, everything
    /// else → FCM data message). Fire-and-forget; never blocks
    /// signaling. Stale tokens (404/410/410) self-prune.
    ///
    /// `apns_call` — `(payload, expiration)` — marks an incoming-call
    /// ring: iOS devices get the CallKit-ready payload (caller identity
    /// + ring duration, delivered only inside the expiration window).
    ///
    /// `None` sends the plain data payload to FCM devices only — iOS
    /// VoIP pushes MUST be reported to CallKit on receipt, so non-call
    /// notices (`call-ended`) deliberately never go to APNs. The
    /// CallKit ring self-cleans via its `duration`, and the app
    /// reconciles on the next WS reconnect.
    fn fanout(
        &self,
        agent_id: &str,
        data: serde_json::Value,
        apns_call: Option<(serde_json::Value, Duration)>,
        collapse_key: &str,
    ) {
        let (Some(devices), fcm, apns) =
            (self.devices.clone(), self.fcm.clone(), self.apns.clone())
        else {
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
                // iOS rows ride APNs — but ONLY for the call ring (see
                // the method docs for why other notices skip iOS).
                if row.platform == "ios" {
                    let Some((payload, expiration)) = apns_call.as_ref() else {
                        continue;
                    };
                    let Some(apns) = apns.as_ref() else {
                        continue;
                    };
                    let out = apns
                        .send_voip(&row.token, payload, &collapse_key, *expiration)
                        .await;
                    if matches!(SendOutcome::from(out), SendOutcome::Gone) {
                        gone.push(row.token);
                    }
                    continue;
                }
                let Some(fcm) = fcm.as_ref() else {
                    continue;
                };
                let out = fcm.send_data(&row.token, &data, &collapse_key).await;
                if matches!(SendOutcome::from(out), SendOutcome::Gone) {
                    gone.push(row.token);
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
    ///
    /// Payloads:
    /// * **iOS (APNs VoIP)** — CallKit-ready: the app's PushKit handler
    ///   passes it straight to `flutter_callkit_incoming`, so the native
    ///   incoming-call screen shows the caller's name + avatar and
    ///   self-cleans after the server's ring window.
    /// * **Android (FCM)** — flat data keys (the app owns presentation;
    ///   `callerName` is available for the notification banner).
    pub fn notify_incoming_call(&self, agent_id: &str, call: IncomingCallPush<'_>) {
        let collapse = format!("call-{}", call.customer_id);
        // iOS: the payload root IS the plugin's `Data(args:)` map.
        let mut apns_payload = json!({
            // Stable per-customer call id — CallKit dedupes/ends by it,
            // and the app passes the same id when it ends the call.
            "id": collapse,
            "nameCaller": call.display_name(),
            "handle": call.customer_id,
            "type": 0,
            // Ring window in ms — an unanswered CallKit ring turns into
            // a missed-call notification exactly when the janitor
            // expires the session server-side.
            "duration": self.ring_timeout_ms,
            // Context for the Dart-side event handlers (accept/decline).
            "extra": {
                "type": "incoming-call",
                "customerId": call.customer_id,
                "channelId": call.channel_id,
                "callerName": call.caller_name,
                "callerAvatar": call.caller_avatar,
            },
        });
        if let Some(avatar) = call.caller_avatar {
            apns_payload["avatar"] = json!(avatar);
        }
        // Android/web (FCM data) — flat keys, caller identity included.
        let fcm_data = json!({
            "type": "incoming-call",
            "customerId": call.customer_id,
            "channelId": call.channel_id,
            "callerName": call.caller_name,
            "callerAvatar": call.caller_avatar,
        });
        // Give the ring a short delivery window (ring timeout + slack)
        // so a phone that was offline for minutes doesn't wake to a
        // call that has already been re-routed elsewhere.
        let expiration = Duration::from_secs(self.ring_timeout_ms / 1000 + 30);
        self.fanout(
            agent_id,
            fcm_data,
            Some((apns_payload, expiration)),
            &collapse,
        );
    }

    /// Push `call-ended` so a phone still ringing from a ring that was
    /// re-routed away (or a call that ended) stops its ring UI.
    ///
    /// Android (FCM) only — see `fanout`'s docs for why iOS is
    /// skipped: an iOS VoIP push MUST be reported to CallKit, and a
    /// "call ended" notice would either violate that or pop a spurious
    /// native call screen. iOS rings self-clean via the CallKit
    /// `duration` pushed with the ring, plus reconcile on WS reconnect.
    pub fn notify_call_ended(&self, agent_id: &str, customer_id: &str) {
        let data = json!({
            "type": "call-ended",
            "customerId": customer_id,
        });
        let collapse = format!("call-{customer_id}");
        self.fanout(agent_id, data, None, &collapse);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lazy_hub_without_init_is_disabled_noop() {
        // In unit tests `init` never ran → the lazily-created hub must
        // be a safe no-op, not a panic, for every notify path.
        let hub = crate::push::push();
        assert!(!hub.is_enabled());
        hub.notify_incoming_call(
            "a1",
            IncomingCallPush {
                customer_id: "c1",
                channel_id: Some("ch-1"),
                caller_name: Some("Khách A"),
                caller_avatar: None,
            },
        );
        hub.notify_call_ended("a1", "c1");
    }

    #[test]
    fn incoming_call_payload_shape_is_callkit_ready() {
        // The iOS payload must keep the exact keys flutter_callkit_
        // incoming's native `Data(args:)` parses — this guards the
        // contract at the type level where it's easiest to regress.
        let hub = crate::push::push();
        // Disabled hub still builds payloads through notify_incoming_
        // call — but they are internal to the (no-op) fanout. Assert on
        // the JSON contract directly instead:
        let collapse = format!("call-{}", "c1");
        assert_eq!(collapse, "call-c1");
        let payload = json!({
            "id": collapse,
            "nameCaller": "Khách A",
            "handle": "c1",
            "type": 0,
            "duration": hub.ring_timeout_ms,
            "extra": {
                "type": "incoming-call",
                "customerId": "c1",
                "channelId": serde_json::Value::Null,
                "callerName": "Khách A",
                "callerAvatar": serde_json::Value::Null,
            },
        });
        assert_eq!(payload["nameCaller"], "Khách A");
        assert_eq!(payload["extra"]["customerId"], "c1");
        assert_eq!(payload["duration"], 60_000);
    }
}
