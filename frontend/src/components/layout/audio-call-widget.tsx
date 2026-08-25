'use client'

/**
 * AudioCallWidget — 1-1 WebRTC audio call UI for customer ↔ support agent.
 *
 * ## UX
 *
 *   * Floating action button (FAB) in the bottom-right corner, above the
 *     existing support chat FAB. Click → opens the call panel.
 *
 *   * Call panel states:
 *       - idle: shows "Call support" button + agent online status
 *       - calling: shows "Calling..." + cancel button
 *       - incoming: (agent only) shows "Incoming call from X" + Accept/Reject
 *       - connecting: shows "Connecting..." spinner
 *       - active: shows call duration + Mute + Hang up buttons
 *       - ended: shows "Call ended" for 2.5s, then back to idle
 *
 *   * Mobile-first: the panel is full-width on mobile (`w-full max-w-sm`),
 *     buttons are 48px touch targets, safe-area padding at the bottom.
 *
 * ## Permissions
 *
 *   * Customers: only shown if user has `calls.initiate` RBAC permission.
 *   * Agents: only shown if user has `calls.receive` RBAC permission +
 *     actor_type === 'employee'.
 *
 * ## Performance
 *
 *   * The audio-call-client lib is lazy-loaded via dynamic import so the
 *     main bundle isn't bloated with WebRTC code (most users never make
 *     a call).
 *
 *   * The signaling WS only connects when the user opens the panel — we
 *     don't keep a socket alive for users who never use the feature.
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { useApp } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Phone, PhoneOff, Mic, MicOff, X, PhoneIncoming, PhoneOutgoing, Loader2, Signal } from 'lucide-react'
import type { AudioCallClient } from '@/lib/audio-call-client'
import { playSound, startRingTone } from '@/lib/sound-effects'
import { ensureCallNotificationPermission, notifyIncomingCall } from '@/lib/notifications'

type CallState = 'idle' | 'calling' | 'incoming' | 'connecting' | 'active' | 'ended'

// Build signaling URL — points at the native Rust `/ws-call` endpoint on
// the same origin (Vite proxies it to :8080 in dev, Caddy routes it in
// prod). The browser sends the `vx_access` cookie automatically on the
// WS upgrade, so we don't need to put the JWT in the URL.
function buildSignalingUrl(): string {
  if (typeof window === 'undefined') return `${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080'}/ws-call`
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws-call`
}

export function AudioCallWidget() {
  const { user, chatOpen } = useApp()
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<CallState>('idle')
  const [onlineAgents, setOnlineAgents] = useState(0)
  const [micOn, setMicOn] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [callDuration, setCallDuration] = useState(0)
  const [incomingFrom, setIncomingFrom] = useState<{ from: string; sdp: any } | null>(null)

  const clientRef = useRef<AudioCallClient | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Wake Lock sentinel — keeps the screen on during an active call so
  // the proximity sensor doesn't dim/lock the screen and drop the call.
  const wakeLockRef = useRef<any>(null)
  // Ring tone stop function — clears the repeating interval when the
  // call transitions out of 'calling' or 'incoming'.
  const stopRingRef = useRef<(() => void) | null>(null)

  // ── Wake Lock helpers ──────────────────────────────────────────
  // Keeps the screen on during an active call. The wake lock is released
  // when the call ends or when the user switches tabs (the OS re-acquires
  // it on resume; we listen for visibilitychange and re-request).
  const requestWakeLock = useCallback(async () => {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return
    try {
      wakeLockRef.current = await (navigator as any).wakeLock.request('screen')
      wakeLockRef.current?.addEventListener?.('release', () => {
        wakeLockRef.current = null
      })
    } catch {
      // Wake Lock can fail if not HTTPS, user denied, or screen off.
      // Silent failure — calls still work, just no wake lock.
    }
  }, [])

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      try {
        wakeLockRef.current.release()
      } catch {
        // noop
      }
      wakeLockRef.current = null
    }
  }, [])

  // Re-acquire wake lock on tab visibility change (mobile browsers
  // release the lock when the tab is backgrounded).
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && state === 'active') {
        requestWakeLock()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [state, requestWakeLock])

  // Initialize client when the panel is first opened.
  const ensureClient = useCallback(async () => {
    if (clientRef.current) return clientRef.current
    if (!user) throw new Error('Not authenticated')
    const { AudioCallClient } = await import('@/lib/audio-call-client')
    const role = user.type === 'employee' ? 'agent' : 'customer'
    const client = new AudioCallClient({
      signalingUrl: buildSignalingUrl(),
      token: '',
      userId: user.id,
      role,
      channelId: undefined,
    })
    if (audioRef.current) client.remoteAudioElement = audioRef.current
    client.on('state', (s: CallState) => {
      setState(s)
      if (s === 'active' && callTimerRef.current === null) {
        callTimerRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000)
        requestWakeLock()
        // ── Sound: call connected — ascending tone.
        playSound('connect')
        // Stop any ring tone that was playing.
        stopRingRef.current?.()
        stopRingRef.current = null
      }
      if (s === 'calling') {
        // ── Sound: outgoing call — repeating ring tone.
        stopRingRef.current?.()
        stopRingRef.current = startRingTone('ring')
      }
      if (s === 'incoming') {
        // ── Sound: incoming call — repeating double-beep.
        stopRingRef.current?.()
        stopRingRef.current = startRingTone('incoming')
      }
      if (s === 'ended' || s === 'idle') {
        // Stop the call duration timer + wake lock if the call was active.
        if (callTimerRef.current) {
          clearInterval(callTimerRef.current)
          callTimerRef.current = null
          setCallDuration(0)
          releaseWakeLock()
          // ── Sound: call ended — descending tone.
          // Only play this when a connected call actually ends, NOT when
          // the user cancels an unanswered outgoing call (no sound then,
          // per UX requirement: cancelling a call should be silent).
          playSound('end')
        }
        // Always stop any ring tone — critical when the user cancels
        // while still in 'calling'/'incoming'. The call never reached
        // 'active', so callTimerRef was never set and the ring tone
        // would otherwise keep looping forever.
        stopRingRef.current?.()
        stopRingRef.current = null
      }
    })
    client.on('presence', ({ onlineAgents }: { onlineAgents: number }) => setOnlineAgents(onlineAgents))
    // When the signaling WS closes (agent logged out, network drop),
    // reset onlineAgents to 0 so the call button disables immediately.
    client.on('_close', () => {
      setOnlineAgents(0)
    })
    client.on('incoming', ({ from, sdp }: { from: string; sdp: any }) => {
      setIncomingFrom({ from, sdp })
      // ── Browser push notification for incoming call (when page is hidden).
      notifyIncomingCall('Khách hàng')
    })
    client.on('error', ({ message }: { message: string }) => {
      setError(message)
      setTimeout(() => setError(null), 4000)
    })
    client.on('hangup', () => {
      setIncomingFrom(null)
      if (callTimerRef.current) { clearInterval(callTimerRef.current); callTimerRef.current = null }
      setCallDuration(0)
    })
    client.connect()
    clientRef.current = client
    return client
  }, [user])

  // Start a call (customer → agent, or agent → customer).
  const startCall = useCallback(async () => {
    setError(null)
    const client = await ensureClient()
    await client.startCall()
  }, [ensureClient])

  // Accept inbound call. (The duration timer is NOT started here — it starts
  // when the call actually reaches 'active', which for the answering side is
  // only once the peer connection reports 'connected'.)
  const acceptCall = useCallback(async () => {
    if (!incomingFrom) return
    const client = await ensureClient()
    await client.acceptCall(incomingFrom.sdp, incomingFrom.from)
    setIncomingFrom(null)
  }, [ensureClient, incomingFrom])

  // Reject inbound call.
  const rejectCall = useCallback(async () => {
    if (!incomingFrom) return
    const client = await ensureClient()
    client.rejectCall(incomingFrom.from)
    setIncomingFrom(null)
    // Stop the incoming-call ring tone immediately — rejecting a call
    // should be silent. The state handler will also do this, but we
    // do it here first for instant feedback.
    stopRingRef.current?.()
    stopRingRef.current = null
  }, [ensureClient, incomingFrom])

  // Hang up. Always cancels the ring tone IMMEDIATELY — the
  // audio-call-client's `hangup()` triggers a state transition to
  // 'ended' which fires the state handler below, but we stop the ring
  // here too in case the state event is delayed or dropped (e.g. WS
  // closed). Belt + suspenders: the state handler ALSO stops the
  // ring, so calling `stopRingRef.current?.()` twice is safe (the
  // stop fn is idempotent — `clearInterval` + `clearTimeout` on an
  // already-cleared id are no-ops).
  const hangup = useCallback(() => {
    clientRef.current?.hangup()
    if (callTimerRef.current) { clearInterval(callTimerRef.current); callTimerRef.current = null }
    setCallDuration(0)
    // Stop any ring tone IMMEDIATELY — cancelling a call should be
    // silent per the UX requirement. The state handler also calls
    // this, but we do it here first so the ring stops before the
    // 'ended' state event fires (which can take a few ms).
    stopRingRef.current?.()
    stopRingRef.current = null
  }, [])

  // Toggle mic.
  const toggleMic = useCallback(() => {
    if (!clientRef.current) return
    const on = clientRef.current.toggleMic()
    setMicOn(on)
  }, [])

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (callTimerRef.current) clearInterval(callTimerRef.current)
      clientRef.current?.dispose()
      clientRef.current = null
    }
  }, [])

  // ── Auto-connect for agents ──────────────────────────────────────
  // Agents MUST be connected to the signaling WS as soon as they log
  // in — otherwise they can't receive inbound calls, and customers see
  // "no agents online" until the agent manually opens the call panel.
  // We connect automatically for employees even when the panel is
  // closed. The panel opens only when the agent clicks the FAB.
  //
  // For customers: we still connect when the panel opens (below).
  const isAgent = user?.type === 'employee'

  // Connect to the signaling WS as soon as the panel opens (for
  // customers) OR as soon as the agent logs in (for agents).
  useEffect(() => {
    // Agents: connect immediately (panel doesn't need to be open).
    // Customers: connect only when panel is open.
    if (!isAgent && !open) return
    if (!user) return
    let cancelled = false
    ensureClient().catch((e) => {
      if (!cancelled) {
        setError(`Không thể kết nối đến dịch vụ gọi: ${String(e)}`)
        setTimeout(() => setError(null), 4000)
      }
    })
    // Best-effort — don't block the panel open on the permission ask.
    // If the user dismisses the prompt, the call still works; they
    // just won't get a desktop ring if they switch tabs.
    if (open) {
      void ensureCallNotificationPermission()
    }
    return () => { cancelled = true }
  }, [open, ensureClient, isAgent, user])

  if (!user) return null

  // Agent status text. isAgent is already declared above (for the
  // auto-connect effect). Reuse it here.
  const agentsOnline = onlineAgents > 0
  const statusText = isAgent
    ? state === 'active'
      ? 'Đang trong cuộc gọi'
      : state === 'calling' || state === 'connecting'
        ? 'Đang gọi...'
        : 'Sẵn sàng nhận cuộc gọi'
    : agentsOnline
      ? 'Nhân viên đang online'
      : 'Nhân viên đang ngoại tuyến'

  return (
    <>
      {/* Hidden audio element for the remote stream. iOS requires this to
          be present in the DOM with autoplay + playsInline. */}
      <audio ref={audioRef} autoPlay playsInline className="hidden" />

      {/* Floating action button — only when panel is closed. Sits to the
          left of the support-chat FAB so they don't overlap. */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Gọi hỗ trợ"
          className={cn(
            'fixed z-40 right-4 md:right-6 flex items-center justify-center',
            'h-12 w-12 rounded-full',
            'bg-emerald-600 hover:bg-emerald-700 text-white',
            'transition-all hover:scale-105 active:scale-95',
            'border border-emerald-400/30',
            // Sit above the chat FAB (which is at bottom-24) — 56px above.
            chatOpen ? 'bottom-36 md:bottom-36' : 'bottom-24 md:bottom-24',
            // Safe area on iOS.
            'mb-[env(safe-area-inset-bottom)]',
          )}
        >
          <Phone className="h-5 w-5" />
          {/* Incoming call — ring badge visible even when the panel is closed
              (critical for the agent, who must notice inbound calls). */}
          {state === 'incoming' && (
            <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-amber-400 border-2 border-white animate-ping" />
          )}
          {onlineAgents > 0 && !isAgent && state !== 'incoming' && (
            <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-emerald-400 border-2 border-white animate-pulse" />
          )}
        </button>
      )}

      {/* Call panel — floating card. */}
      {open && (
        <div
          className={cn(
            'fixed z-50 right-3 left-3 md:left-auto md:w-80',
            'bottom-3 md:bottom-6',
            'bg-white dark:bg-zinc-900 rounded-2xl',
            'border border-zinc-200 dark:border-zinc-800',
            'p-4 md:p-5',
            'mb-[env(safe-area-inset-bottom)]',
          )}
          role="dialog"
          aria-label="Audio call"
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className={cn(
                'h-2 w-2 rounded-full',
                onlineAgents > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-400',
              )} />
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                {isAgent ? 'Đại diện hỗ trợ' : 'Gọi hỗ trợ'}
              </span>
            </div>
            <button
              onClick={() => {
                if (state === 'active' || state === 'calling' || state === 'connecting') {
                  hangup()
                }
                setOpen(false)
              }}
              aria-label="Đóng"
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors p-1"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Status */}
          <div className="text-center mb-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-1">
              {statusText}
            </div>
            {state === 'idle' && (
              <div className="text-zinc-600 dark:text-zinc-300 text-sm">
                {isAgent
                  ? 'Bạn sẽ nhận được cuộc gọi khi khách hàng cần hỗ trợ.'
                  : onlineAgents > 0
                    ? 'Nhấn để gọi nhân viên hỗ trợ.'
                    : 'Hiện không có nhân viên online. Vui lòng thử lại sau.'}
              </div>
            )}
            {state === 'calling' && (
              <div className="flex flex-col items-center gap-2">
                <PhoneOutgoing className="h-8 w-8 text-emerald-600 animate-pulse" />
                <div className="text-sm text-zinc-600 dark:text-zinc-300">Đang gọi...</div>
              </div>
            )}
            {state === 'incoming' && incomingFrom && (
              <div className="flex flex-col items-center gap-2">
                <PhoneIncoming className="h-8 w-8 text-emerald-600 animate-bounce" />
                <div className="text-sm text-zinc-600 dark:text-zinc-300">
                  Cuộc gọi đến từ khách hàng
                </div>
              </div>
            )}
            {state === 'connecting' && (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 text-emerald-600 animate-spin" />
                <div className="text-sm text-zinc-600 dark:text-zinc-300">Đang kết nối...</div>
              </div>
            )}
            {state === 'active' && (
              <div className="flex flex-col items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <Signal className="h-4 w-4 text-emerald-500" />
                  <span className="text-2xl font-mono font-semibold text-zinc-800 dark:text-zinc-100">
                    {Math.floor(callDuration / 60)}:{String(callDuration % 60).padStart(2, '0')}
                  </span>
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  {micOn ? 'Micro đang bật' : 'Đã tắt micro'}
                </div>
              </div>
            )}
            {state === 'ended' && (
              <div className="text-sm text-zinc-500 dark:text-zinc-400">Cuộc gọi đã kết thúc</div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-center gap-3">
            {state === 'idle' && !isAgent && (
              <Button
                onClick={startCall}
                disabled={onlineAgents === 0}
                className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-full h-12 px-6"
              >
                <Phone className="h-5 w-5 mr-2" />
                Gọi ngay
              </Button>
            )}
            {state === 'idle' && isAgent && (
              <div className="text-xs text-zinc-500 dark:text-zinc-400 text-center py-2">
                Đang chờ cuộc gọi từ khách hàng...
              </div>
            )}
            {(state === 'calling' || state === 'connecting' || state === 'active') && (
              <>
                {state === 'active' && (
                  <button
                    onClick={toggleMic}
                    aria-label={micOn ? 'Tắt micro' : 'Bật micro'}
                    className={cn(
                      'h-12 w-12 rounded-full flex items-center justify-center transition-colors',
                      micOn
                        ? 'bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200'
                        : 'bg-red-100 hover:bg-red-200 dark:bg-red-950 dark:hover:bg-red-900 text-red-600',
                    )}
                  >
                    {micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
                  </button>
                )}
                <button
                  onClick={hangup}
                  aria-label="Kết thúc cuộc gọi"
                  className="h-12 w-12 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center transition-colors"
                >
                  <PhoneOff className="h-5 w-5" />
                </button>
              </>
            )}
            {state === 'incoming' && incomingFrom && (
              <>
                <button
                  onClick={rejectCall}
                  aria-label="Từ chối"
                  className="h-12 w-12 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center"
                >
                  <PhoneOff className="h-5 w-5" />
                </button>
                <button
                  onClick={acceptCall}
                  aria-label="Chấp nhận"
                  className="h-12 w-12 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center animate-pulse"
                >
                  <Phone className="h-5 w-5" />
                </button>
              </>
            )}
          </div>

          {/* The AudioCallClient lib is dynamically imported in ensureClient()
              so the main bundle stays small. */}
        </div>
      )}
    </>
  )
}
