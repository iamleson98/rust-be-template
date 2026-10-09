/**
 * Call-quality classification + human-readable call-end reasons.
 *
 * Pure helpers (no WebRTC imports) so they are unit-testable and shared
 * between the call client (emits `quality` events) and the call widget
 * (renders bars / end-of-call text).
 */

import { tSync } from '@/lib/i18n'

/** Resolve a dictionary key in the CURRENT app language (vi default). */
const L = (key: string) => tSync(key)

/** Coarse network-health grade for the ACTIVE call. */
export type QualityLevel = 'good' | 'fair' | 'poor'

/** Raw stats snapshot sampled from `RTCPeerConnection.getStats()`. */
export interface QualityStats {
  /** Round-trip time of the selected candidate pair, ms (null = unknown). */
  rttMs: number | null
  /** Audio jitter, ms (null = unknown). */
  jitterMs: number | null
  /** Lost / total audio packets, percent (null = unknown). */
  lossPct: number | null
  /** True when the selected candidate pair relays through TURN. */
  relayed: boolean | null
}

/**
 * Reduce one `getStats()` report to {@link QualityStats}: RTT from the
 * selected candidate pair, jitter and loss from the inbound audio RTP
 * stream, and `relayed` from the types of the selected pair's candidates.
 */
export function summarizeStats(report: RTCStatsReport): QualityStats {
  let rttMs: number | null = null
  let jitterMs: number | null = null
  let lossPct: number | null = null
  let selected: { local?: string; remote?: string } = {}
  const candidateTypes = new Map<string, string>()

  report.forEach((stat: RTCStats) => {
    const r = stat as unknown as Record<string, unknown>
    if (r.type === 'candidate-pair') {
      // Older browsers only flag `nominated` + succeeded.
      const chosen = r.selected === true || (r.nominated === true && r.state === 'succeeded')
      if (chosen && typeof r.currentRoundTripTime === 'number') {
        rttMs = Math.round(r.currentRoundTripTime * 1000)
        selected = {
          local: typeof r.localCandidateId === 'string' ? r.localCandidateId : undefined,
          remote: typeof r.remoteCandidateId === 'string' ? r.remoteCandidateId : undefined,
        }
      }
    } else if (r.type === 'local-candidate' || r.type === 'remote-candidate') {
      candidateTypes.set(String(r.id), typeof r.candidateType === 'string' ? r.candidateType : '')
    } else if (r.type === 'inbound-rtp' && r.kind === 'audio') {
      if (typeof r.jitter === 'number') jitterMs = Math.round(r.jitter * 1000)
      const lost = typeof r.packetsLost === 'number' ? r.packetsLost : null
      const received = typeof r.packetsReceived === 'number' ? r.packetsReceived : null
      if (lost !== null && received !== null && lost + received > 0) {
        lossPct = Math.round((lost / (lost + received)) * 1000) / 10
      }
    }
  })

  const local = selected.local ? candidateTypes.get(selected.local) : undefined
  const remote = selected.remote ? candidateTypes.get(selected.remote) : undefined
  const relayed = local === undefined && remote === undefined ? null : local === 'relay' || remote === 'relay'
  return { rttMs, jitterMs, lossPct, relayed }
}

/** Classify sampled stats into a 3-level grade.
 *
 * Thresholds (audio call, opus ~40kbps — very tolerant):
 *   good  — rtt ≤ 250 ms, loss ≤ 2%, jitter ≤ 30 ms
 *   fair  — rtt ≤ 500 ms, loss ≤ 8%, jitter ≤ 60 ms
 *   poor  — anything worse (or nothing measured yet but a pair exists)
 *
 * Unknown (`null`) metrics never PENALIZE the grade — a missing stat is
 * "not reported", not "bad". All-null samples classify as `good` so the
 * indicator shows a sane default until real numbers arrive.
 */
export function classifyQuality(s: QualityStats): QualityLevel {
  const ok = (v: number | null, limit: number): boolean => (v === null ? true : v <= limit)
  if (ok(s.rttMs, 250) && ok(s.lossPct, 2) && ok(s.jitterMs, 30)) return 'good'
  if (ok(s.rttMs, 500) && ok(s.lossPct, 8) && ok(s.jitterMs, 60)) return 'fair'
  return 'poor'
}

/** Friendly end-of-call text from the signaling `hangup.reason`.
 *
 * `isAgent` flips the perspective: the same `declined` reason means
 * "the customer declined" to the agent and "the agent declined" to the
 * customer.
 */
export function hangupReasonText(reason: string | null | undefined, isAgent: boolean): string {
  switch (reason) {
    case 'declined':
      return isAgent ? L('call.customerDeclined') : L('call.agentDeclined')
    case 'busy':
      return isAgent ? L('call.customerBusy') : L('call.agentBusy')
    case 'timeout':
      return L('call.timeoutNoAnswer')
    case 'mic-denied':
      return isAgent ? L('call.customerMicDenied') : L('call.agentMicDenied')
    case 'peer-offline':
      return L('call.peerOffline')
    case 'agent-offline':
      return L('call.agentOffline')
    case 'answered-elsewhere':
      return L('call.answeredElsewhere')
    case 'expired':
      return L('call.expired')
    case 'replaced':
      return L('call.replaced')
    case 'remote':
    default:
      return L('call.ended')
  }
}

/** Actionable guidance shown when OUR side cannot open the microphone —
 *  language-reactive (vi default, English after the VI/EN switch). */
export function micDeniedGuidance(): string {
  return L('call.micDeniedGuidance')
}
