/**
 * "Ring even when the app is closed": device pushes that accompany the call
 * hub's WebSocket ring (port of the Rust `push::PushHub`).
 *
 *  - iOS rows → APNs VoIP, CallKit-ready payload (name, avatar, ring window).
 *  - everything else → FCM data message.
 *  - "call ended" goes to FCM devices only: an iOS VoIP push MUST be reported
 *    to CallKit on receipt, so a non-ring notice would pop a phantom call
 *    screen. iOS rings self-clean via the CallKit `duration` we send.
 *
 * Config-gated and best-effort: with no FCM_CREDENTIALS_JSON / APNS_* secrets
 * every call is a cheap no-op; failures never reach call setup; tokens FCM or
 * APNs report as gone are pruned.
 */
import { apnsConfigFrom, sendApnsVoip } from "./apns";
import { deleteDeviceByToken, listDevices } from "./devices";
import { parseServiceAccount, sendFcmData, type SendOutcome } from "./fcm";

export interface PushEnv {
  DB: D1Database;
  FCM_CREDENTIALS_JSON?: string;
  APNS_KEY_PEM?: string;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_TOPIC?: string;
  APNS_SANDBOX?: string;
  AUDIO_CALL_RING_TIMEOUT_SECS?: string;
}

export interface IncomingCallPush {
  customerId: string;
  channelId: string | null;
  callerName: string | null;
  callerAvatar: string | null;
}

export function pushEnabled(env: PushEnv): boolean {
  return parseServiceAccount(env.FCM_CREDENTIALS_JSON) !== null || apnsConfigFrom(env) !== null;
}

/** The iOS payload root IS the CallKit plugin's `Data(args:)` map. */
export function callKitPayload(call: IncomingCallPush, ringMs: number): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: `call-${call.customerId}`,
    nameCaller: call.callerName?.trim() || "Khách hàng",
    handle: call.customerId,
    type: 0,
    duration: ringMs,
    extra: {
      type: "incoming-call",
      customerId: call.customerId,
      channelId: call.channelId,
      callerName: call.callerName,
      callerAvatar: call.callerAvatar,
    },
  };
  if (call.callerAvatar) payload.avatar = call.callerAvatar;
  return payload;
}

async function fanout(
  env: PushEnv,
  agentId: string,
  data: Record<string, unknown>,
  apnsCall: { payload: Record<string, unknown>; expirationSecs: number } | null,
  collapseKey: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const fcm = parseServiceAccount(env.FCM_CREDENTIALS_JSON);
  const apns = apnsConfigFrom(env);
  if (!fcm && !apns) return;
  try {
    const devices = await listDevices(env.DB, agentId);
    const gone: string[] = [];
    await Promise.all(
      devices.map(async (d) => {
        let out: SendOutcome | null = null;
        if (d.platform === "ios") {
          if (apnsCall && apns) {
            out = await sendApnsVoip(
              apns,
              d.token,
              apnsCall.payload,
              collapseKey,
              apnsCall.expirationSecs,
              fetchImpl,
            );
          }
        } else if (fcm) {
          out = await sendFcmData(fcm, d.token, data, collapseKey, fetchImpl);
        }
        if (out === "gone") gone.push(d.token);
      }),
    );
    for (const token of gone) await deleteDeviceByToken(env.DB, token);
  } catch {
    // Best effort: the WebSocket ring is the source of truth.
  }
}

export async function notifyIncomingCall(
  env: PushEnv,
  agentId: string,
  call: IncomingCallPush,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const ringMs = Math.max(5, Number(env.AUDIO_CALL_RING_TIMEOUT_SECS) || 60) * 1000;
  const collapse = `call-${call.customerId}`;
  await fanout(
    env,
    agentId,
    {
      type: "incoming-call",
      customerId: call.customerId,
      channelId: call.channelId,
      callerName: call.callerName,
      callerAvatar: call.callerAvatar,
    },
    // A short delivery window (ring + slack): a phone offline for minutes must
    // not wake to a call that was already re-routed elsewhere.
    { payload: callKitPayload(call, ringMs), expirationSecs: ringMs / 1000 + 30 },
    collapse,
    fetchImpl,
  );
}

export async function notifyCallEnded(
  env: PushEnv,
  agentId: string,
  customerId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await fanout(
    env,
    agentId,
    { type: "call-ended", customerId },
    null,
    `call-${customerId}`,
    fetchImpl,
  );
}
