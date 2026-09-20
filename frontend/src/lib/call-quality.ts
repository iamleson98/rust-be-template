/**
 * Call-quality classification + human-readable call-end reasons.
 *
 * Pure helpers (no WebRTC imports) so they are unit-testable and shared
 * between the call client (emits `quality` events) and the call widget
 * (renders bars / end-of-call text).
 */

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
  const ok = (v: number | null, limit: number): boolean =>
    v === null ? true : v <= limit
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
export function hangupReasonText(
  reason: string | null | undefined,
  isAgent: boolean,
): string {
  switch (reason) {
    case 'declined':
      return isAgent
        ? 'Khách hàng từ chối cuộc gọi'
        : 'Nhân viên từ chối cuộc gọi'
    case 'busy':
      return isAgent
        ? 'Khách hàng đang bận'
        : 'Nhân viên đang bận'
    case 'timeout':
      return 'Không nhấc máy — hết thời gian chờ'
    case 'mic-denied':
      return isAgent
        ? 'Khách hàng không cấp quyền micro'
        : 'Không truy cập được micro ở phía nhân viên'
    case 'peer-offline':
      return 'Mất kết nối với người gọi'
    case 'agent-offline':
      return 'Nhân viên đã ngoại tuyến'
    case 'answered-elsewhere':
      return 'Cuộc gọi đã được nhận ở nơi khác'
    case 'expired':
      return 'Cuộc gọi đã quá thời gian'
    case 'replaced':
      return 'Cuộc gọi đã được thay thế'
    case 'remote':
    default:
      return 'Cuộc gọi đã kết thúc'
  }
}

/** Actionable guidance shown when OUR side cannot open the microphone. */
export const MIC_DENIED_GUIDANCE =
  'Trình duyệt đang chặn micro. Nhấn biểu tượng micro/ổ khóa trên thanh địa chỉ → cho phép Micro → gọi lại.'
