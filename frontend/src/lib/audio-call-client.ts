/**
 * WebRTC audio-call client — brokers 1-1 calls between a customer and the
 * support agent via the native Rust signaling endpoint `/ws-call`.
 *
 * ## Architecture
 *
 *   Browser (customer)  ──WS──►  Rust /ws-call (port 8080)  ◄──WS──  Browser (agent)
 *        RTCPeerConnection  ◄────────── ICE / SDP ──────────►  RTCPeerConnection
 *
 * The signaling endpoint ONLY relays SDP offers/answers and ICE candidates.
 * The actual audio flows DIRECTLY between the two browsers over WebRTC
 * (peer-to-peer). For NAT traversal we rely on Google's public STUN servers
 * by default; for production behind strict NATs, set TURN servers via the
 * backend `AUDIO_CALL_ICE_SERVERS` env var — they're pushed to this client
 * in the `registered` message over the authed WS (see `handleSignal`), so
 * TURN credentials never hit an unauthenticated HTTP endpoint.
 *
 * ## Auth
 *
 * The browser sends the `vx_access` cookie automatically on the WS upgrade
 * request (same-origin), so no token needs to go in the URL. The Rust
 * handler reads the cookie + verifies the JWT — the `userId` claim is
 * taken from the token, NOT trusted from the client payload.
 *
 * ## Mobile considerations
 *
 *   * `getUserMedia({ audio: true })` requires HTTPS on mobile (or
 *     `http://localhost`). The dev server is HTTP, but Vite serves on
 *     localhost so it works. In production, Caddy terminates TLS.
 *
 *   * iOS Safari requires the audio element to be `play()`ed from within
 *     a user-gesture handler. We call `audioRef.play()` inside the
 *     `incoming` handler, which fires from a button click.
 *
 *   * Echo cancellation + noise suppression + autoGainControl are enabled
 *     by default on the audio track constraints — critical for mobile
 *     speakers.
 *
 *   * The remote audio is rendered via a hidden `<audio>` element with
 *     `autoplay` + `playsInline` (iOS won't autoplay otherwise).
 *
 * ## Network-resilience features (corporate NAT / IP churn)
 *
 *   * **ICE candidate buffering** — candidates generated while the
 *     signaling WS is down (an IP-rotating office network kills it
 *     silently) are buffered and re-flushed on reconnect; a lost
 *     candidate leaves the peer with an incomplete set = the
 *     "stuck on connecting" failure.
 *   * **ICE restart (renegotiation)** — when the media path fails, the
 *     ORIGINAL OFFERER re-offers with `iceRestart: true` once per call;
 *     the server relays it as a `renegotiate` frame and the answerer
 *     re-answers on its EXISTING peer connection. Fresh candidates
 *     without re-ringing. The mobile client speaks the same protocol.
 */

export type CallRole = 'customer' | 'agent'

// Re-exported for the widget (keeps a single quality vocabulary).
export type { QualityLevel, QualityStats } from '@/lib/call-quality'
import { classifyQuality, type QualityStats } from '@/lib/call-quality'
import { translate } from '@/lib/i18n'
import { useApp } from '@/lib/store'

/** Resolve a dictionary key in the CURRENT app language (vi default). */
const L = (key: string) => translate(useApp.getState().lang, key)

export type CallState =
  | 'idle'         // no active call
  | 'calling'      // outbound: waiting for answer
  | 'incoming'     // inbound: ringing, user hasn't accepted
  | 'connecting'   // offer accepted, ICE in progress
  | 'active'       // call is live
  | 'ended'        // call just ended (UI shows "Call ended" for 3s)

export interface IceServerConfig {
  urls: string | string[]
  username?: string
  credential?: string
}

export interface AudioCallConfig {
  /** WS URL of the signaling service. Includes XTransformPort for Caddy. */
  signalingUrl: string
  /** JWT access token — used for auth (currently informational; the
   * signaling service trusts the userId claim for v1). */
  token: string
  /** This user's id. */
  userId: string
  /** 'customer' or 'agent'. */
  role: CallRole
  /** Optional chat channel id, used for context (e.g. "supporting ticket X"). */
  channelId?: string
  /** STUN/TURN servers. Defaults to Google STUN. */
  iceServers?: IceServerConfig[]
}

/**
 * Typed payload shapes the client emits. Handlers passed to `on()`
 * get these types — no more `any` at subscription sites.
 */
export interface AudioCallEventMap {
  state: CallState
  registered: Record<string, unknown>
  presence: { onlineAgents: number; agentInCall?: boolean; agentsAvailable?: boolean }
  incoming: { from: string; channelId?: string; sdp: RTCSessionDescriptionInit }
  error: { code: string; message: string }
  hangup: { reason: string }
  '_close': { code: number; reason: string }
  'remote-stream': { stream: MediaStream }
  'connection-state': { state: RTCPeerConnectionState }
  'ice-restart': { attempts: number }
  quality: QualityStats & { level: ReturnType<typeof classifyQuality> }
}

type SignalHandler<K extends keyof AudioCallEventMap> = (data: AudioCallEventMap[K]) => void

/** Narrow an unknown JSON field to a number (fallback when absent/invalid). */
function asNum(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** Narrow an unknown JSON field to a string (null when absent/invalid). */
function asStr(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

const DEFAULT_ICE_SERVERS: IceServerConfig[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
]

/** How long an outbound call rings before we give up (ms). */
const CALL_TIMEOUT_MS = 30_000
/** How long an inbound call rings before we auto-reject as busy (ms). */
const RING_TIMEOUT_MS = 30_000
/** How long media (ICE) may take to connect after the SDP exchange —
 * covers BOTH sides: the callee sits in `connecting`, the caller jumps
 * to `active` before any audio flows. Without TURN on symmetric NATs
 * this is the difference between a quick clear error and "connecting…"
 * forever until something else times out. */
const CONNECT_TIMEOUT_MS = 20_000

/** Terminal call-setup error codes — any of these ends the local call
 * immediately (the server-side session guard rejected it; ringing on
 * would be pointless). */
const TERMINAL_ERROR_CODES = new Set([
  'no-agent',
  'agents-busy',
  'peer-unavailable',
  'customer-busy',
  'agent-busy',
  'peer-busy',
  'no-session',
])

export class AudioCallClient {
  private cfg: AudioCallConfig
  private ws: WebSocket | null = null
  private pc: RTCPeerConnection | null = null
  private localStream: MediaStream | null = null
  private remoteStream: MediaStream | null = null
  private micEnabled = true
  private reconnectAttempts = 0
  private readonly maxReconnect = 5
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  /** userId of the peer we're currently negotiating/in a call with.
   * Learned from `incoming.from` / `answer.from` / `ice.from` (or the
   * explicit target of an agent-initiated call). This is what hangup and
   * ICE messages must be routed to — the old hardcoded `to: 'agent'` broke
   * agent-side hangup and dropped all agent ICE candidates. */
  private peerId: string | null = null
  private callTimeoutTimer: ReturnType<typeof setTimeout> | null = null
  private ringTimeoutTimer: ReturnType<typeof setTimeout> | null = null
  private connectTimeoutTimer: ReturnType<typeof setTimeout> | null = null
  private mediaConnected = false
  /** Did WE create the initial offer? Only the offerer may drive an ICE
   * restart (WebRTC glare rule: an answerer cannot unilaterally re-offer
   * on an existing negotiation). Set by startCall/acceptCall. */
  private isOfferer = false
  /** ICE restarts attempted this call (capped at 1 — a second restart on
   * the same dead path is noise, the call should end instead). */
  private iceRestarts = 0
  /** ICE candidates generated while the signaling WS was down. The
   * browser's onicecandidate fires once per candidate and is NOT retried —
   * a candidate lost to a WS blip leaves the peer with an incomplete
   * candidate set, which is exactly the "stuck on connecting" signature
   * on networks that rotate IPs (corporate NAT). Buffered and re-flushed
   * on every (re)connect; bounded so a pathological case cannot grow it. */
  private pendingIce: Array<Record<string, unknown>> = []
  private static readonly MAX_PENDING_ICE = 64

  /** Inbound ICE candidates that arrived BEFORE this side's peer
   * connection existed (the caller trickles the moment it creates its
   * offer — i.e. DURING our ring) or before its remote description
   * settled (between the answer frame and setRemoteDescription
   * resolving). These must be BUFFERED, never dropped: browsers do not
   * re-trickle, so a candidate dropped here leaves the peer with an
   * incomplete remote candidate set — the peer cannot send it any
   * connectivity checks, its TURN allocation gets no permission for our
   * addresses, and on strict NATs (carrier CGNAT) media never connects.
   * That is the "answered but stuck on connecting" failure. */
  private inboundIce: RTCIceCandidateInit[] = []
  /** True once setRemoteDescription settled for the current negotiation. */
  private remoteDescReady = false
  private static readonly MAX_INBOUND_ICE = 128

  /** Periodic getStats() sampler while a peer connection exists —
   * feeds the `quality` event (RTT / jitter / loss / relayed). */
  private qualityTimer: ReturnType<typeof setInterval> | null = null
  private static readonly QUALITY_POLL_MS = 2500

  private registered = false
  private registeredResolvers: Array<() => void> = []

  public state: CallState = 'idle'
  public onlineAgents = 0
  public remoteAudioElement: HTMLAudioElement | null = null

  private readonly handlers = new Map<string, Set<(data: unknown) => void>>()

  constructor(cfg: AudioCallConfig) {
    this.cfg = {
      ...cfg,
      iceServers: cfg.iceServers ?? DEFAULT_ICE_SERVERS,
    }
  }

  private waitForRegistered(timeoutMs = 3000): Promise<void> {
    if (this.registered) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.registeredResolvers.indexOf(done)
        if (idx >= 0) this.registeredResolvers.splice(idx, 1)
        resolve()
      }, timeoutMs)
      const done = () => {
        clearTimeout(timer)
        resolve()
      }
      this.registeredResolvers.push(done)
    })
  }

  on<K extends keyof AudioCallEventMap>(event: K, h: SignalHandler<K>): () => void {
    const set = this.handlers.get(event as string) ?? new Set()
    set.add(h as (data: unknown) => void)
    this.handlers.set(event as string, set)
    return () => { set.delete(h as (data: unknown) => void) }
  }

  private emit<K extends keyof AudioCallEventMap>(event: K, data: AudioCallEventMap[K]): void {
    const set = this.handlers.get(event as string)
    if (set) for (const h of set) { try { h(data) } catch { } }
  }

  private setState(s: CallState): void {
    this.state = s
    this.emit('state', s)
  }

  // ── Connection ─────────────────────────────────────────────

  connect(): void {
    if (this.disposed) return
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return

    try {
      this.ws = new WebSocket(this.cfg.signalingUrl)
    } catch (e) {
      this.emit('error', { code: 'ws-failed', message: String(e) })
      this.scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0
      this.send({ type: 'register', role: this.cfg.role, userId: this.cfg.userId, channelId: this.cfg.channelId })
      // Candidates buffered while the socket was down ride along with
      // the register — the server relays them to the live session's
      // peer, whose addIceCandidate tolerates duplicates.
      this.flushPendingIce()
      this.startHeartbeat()
    }

    this.ws.onmessage = (ev) => {
      let msg: unknown
      try { msg = JSON.parse(ev.data) } catch { return }
      if (typeof msg === 'object' && msg !== null) {
        this.handleSignal(msg as Record<string, unknown>)
      }
    }

    this.ws.onclose = (ev) => {
      this.stopHeartbeat()
      this.emit('_close', { code: ev.code, reason: ev.reason })
      if (!this.disposed && this.reconnectAttempts < this.maxReconnect) {
        this.scheduleReconnect()
      }
    }

    this.ws.onerror = () => {
      this.emit('error', { code: 'ws-error', message: 'WebSocket error' })
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    this.reconnectAttempts++
    // Exponential backoff with jitter (same pattern as WsClient).
    const expo = Math.min(15_000, 500 * Math.pow(2, this.reconnectAttempts))
    const delay = Math.floor(Math.random() * expo)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'heartbeat' })
    }, 25_000)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null }
  }

  private startQualitySampler(): void {
    this.stopQualitySampler()
    // getStats() is cheap and local — sampling it every 2.5 s while the
    // call is up costs nothing and gives the UI live network health.
    this.qualityTimer = setInterval(() => { void this.sampleQuality() }, AudioCallClient.QUALITY_POLL_MS)
  }

  private stopQualitySampler(): void {
    if (this.qualityTimer) { clearInterval(this.qualityTimer); this.qualityTimer = null }
  }

  /** One getStats() pass → RTT (candidate-pair), jitter/loss (inbound
   * audio RTP), relayed (selected pair's candidates). Emits `quality`. */
  private async sampleQuality(): Promise<void> {
    const pc = this.pc
    if (!pc || this.disposed) return
    try {
      const stats = await pc.getStats()
      let rttMs: number | null = null
      let jitterMs: number | null = null
      let lossPct: number | null = null
      let relayed: boolean | null = null
      const candidatesById = new Map<string, { type: string }>()
      let selectedLocalId: string | null = null
      let selectedRemoteId: string | null = null

      stats.forEach((r: RTCStats) => {
        const rep = r as unknown as Record<string, unknown>
        const t = rep.type as string
        if (t === 'candidate-pair') {
          // Prefer `selected`; older browsers only flag `nominated`+succeeded.
          const isSelected = rep.selected === true ||
            (rep.nominated === true && rep.state === 'succeeded')
          if (isSelected && typeof rep.currentRoundTripTime === 'number') {
            rttMs = Math.round(rep.currentRoundTripTime * 1000)
            selectedLocalId = typeof rep.localCandidateId === 'string' ? rep.localCandidateId : null
            selectedRemoteId = typeof rep.remoteCandidateId === 'string' ? rep.remoteCandidateId : null
          }
        } else if (t === 'local-candidate' || t === 'remote-candidate') {
          const candidateType = typeof rep.candidateType === 'string' ? rep.candidateType : ''
          candidatesById.set(rep.id as string, { type: candidateType })
        } else if (t === 'inbound-rtp' && rep.kind === 'audio') {
          if (typeof rep.jitter === 'number') {
            jitterMs = Math.round(rep.jitter * 1000)
          }
          const lost = typeof rep.packetsLost === 'number' ? rep.packetsLost : null
          const recv = typeof rep.packetsReceived === 'number' ? rep.packetsReceived : null
          if (lost !== null && recv !== null && lost + recv > 0) {
            lossPct = Math.round((lost / (lost + recv)) * 1000) / 10
          }
        }
      })

      // Either end going through a TURN relay → the pair is relayed.
      const local = selectedLocalId ? candidatesById.get(selectedLocalId) : undefined
      const remote = selectedRemoteId ? candidatesById.get(selectedRemoteId) : undefined
      if (local || remote) {
        relayed = local?.type === 'relay' || remote?.type === 'relay'
      }

      const sample: QualityStats = { rttMs, jitterMs, lossPct, relayed }
      this.emit('quality', { ...sample, level: classifyQuality(sample) })
    } catch {
      // getStats during ICE restarts can transiently fail — skip sample.
    }
  }

  dispose(): void {
    this.disposed = true
    this.stopHeartbeat()
    this.stopQualitySampler()
    this.clearCallTimeout()
    this.clearRingTimeout()
    this.clearConnectTimeout()
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    this.hangup()
    if (this.ws) { try { this.ws.close() } catch { }; this.ws = null }
    this.handlers.clear()
  }

  private send(msg: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify(msg)) } catch { }
    }
  }

  /** Send an ICE candidate, or buffer it when the socket is down and the
   * call is live (see `pendingIce`). */
  private sendOrBufferIce(to: string, candidate: unknown): void {
    const msg: Record<string, unknown> = { type: 'call', to, from: this.cfg.userId, kind: 'ice', candidate }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify(msg)) } catch { }
    } else if (this.isCallLive() && this.pendingIce.length < AudioCallClient.MAX_PENDING_ICE) {
      this.pendingIce.push(msg)
    }
  }

  private flushPendingIce(): void {
    if (this.pendingIce.length === 0) return
    const queued = this.pendingIce.splice(0)
    for (const msg of queued) this.send(msg)
  }

  /** Apply inbound candidates buffered while the peer connection was
   * absent or its remote description had not settled. Stale/duplicate
   * candidates simply fail their addIceCandidate — never fatal. */
  private async flushInboundIce(): Promise<void> {
    if (!this.pc || this.inboundIce.length === 0) return
    const queued = this.inboundIce.splice(0)
    for (const cand of queued) {
      if (!this.pc) return
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(cand))
      } catch { /* stale or duplicate — harmless */ }
    }
  }

  // ── Signal handling ────────────────────────────────────────

  private isCallLive(): boolean {
    return this.state === 'calling' || this.state === 'incoming' ||
      this.state === 'connecting' || this.state === 'active'
  }

  private handleSignal(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case 'registered': {
        this.registered = true
        this.onlineAgents = asNum(msg.onlineAgents)
        // Server-provided STUN/TURN config (AUDIO_CALL_ICE_SERVERS), pushed
        // over the authed WS. Empty/absent → keep the public-STUN default.
        // Applies to every RTCPeerConnection created after this point.
        if (Array.isArray(msg.iceServers) && msg.iceServers.length > 0) {
          this.cfg.iceServers = msg.iceServers
        }
        for (const resolve of this.registeredResolvers) resolve()
        this.registeredResolvers = []
        // Reconcile with server session truth: a client whose socket
        // dropped mid-call reconnects + re-registers, and the server
        // tells it (activeCall) whether a session still exists. null +
        // live local call = zombie — the end-of-call hangup was sent to
        // the OTHER side, so this is the only place we can learn it.
        // (A transient WS blip that reconnects with the session still
        // alive keeps the call — audio is peer-to-peer, only the
        // reconciliation decides, never the socket-close event itself.)
        if (!this.disposed && this.isCallLive() && !msg.activeCall) {
          this.clearCallTimeout()
          this.clearRingTimeout()
          this.clearConnectTimeout()
          this.cleanupCall()
          this.setState('ended')
          this.emit('error', { code: 'call-gone', message: L('call.ended') })
          setTimeout(() => this.setState('idle'), 2500)
        }
        this.emit('registered', msg)
        this.emit('presence', { onlineAgents: this.onlineAgents })
        break
      }
      case 'presence':
        this.onlineAgents = asNum(msg.onlineAgents)
        this.emit('presence', { onlineAgents: this.onlineAgents })
        break
      case 'incoming': {
        // Busy guard: one call at a time. Auto-reject with `busy` so the
        // caller gets an immediate response instead of ringing into a void
        // while we're already on another call.
        if (this.state !== 'idle' || this.pc) {
          this.send({ type: 'hangup', to: asStr(msg.from) ?? '', reason: 'busy', from: this.cfg.userId })
          break
        }
        this.peerId = asStr(msg.from)
        this.setState('incoming')
        this.emit('incoming', {
          from: asStr(msg.from) ?? '',
          channelId: asStr(msg.channelId) ?? undefined,
          sdp: msg.sdp as RTCSessionDescriptionInit,
        })
        this.startRingTimeout()
        break
      }
      case 'answer':
        // Our offer was accepted — set remote description.
        this.clearCallTimeout()
        if (typeof msg.from === 'string') this.peerId = msg.from
        if (this.pc && msg.sdp) {
          this.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit))
            .then(() => {
              // The answerer's candidates may have arrived while the
              // remote description was still settling — flush them now.
              this.remoteDescReady = true
              return this.flushInboundIce()
            })
            .then(() => this.setState('active'))
            .catch((e) => this.emit('error', { code: 'set-remote-desc', message: String(e) }))
          // Caller side: 'active' already, but media may never connect.
          this.startConnectTimeout()
        }
        break
      case 'ice':
        if (typeof msg.from === 'string' && !this.peerId) this.peerId = msg.from
        {
          const cand = msg.candidate as RTCIceCandidateInit | undefined
          if (cand) {
            // Buffer while the pc is absent (ring phase) or the remote
            // description has not settled — addIceCandidate would reject
            // before setRemoteDescription, and dropping the candidate
            // loses it forever (browsers never re-trickle).
            if (this.pc && this.remoteDescReady) {
              this.pc.addIceCandidate(new RTCIceCandidate(cand))
                .catch((e) => this.emit('error', { code: 'add-ice', message: String(e) }))
            } else if (this.isCallLive() && this.inboundIce.length < AudioCallClient.MAX_INBOUND_ICE) {
              this.inboundIce.push(cand)
            }
          }
        }
        break
      case 'renegotiate': {
        // ICE restart: the peer (always the original OFFERER) re-offered
        // with fresh candidates after the media path failed. Apply it to
        // the EXISTING peer connection — never re-ring, never a new call.
        const sdp = msg.sdp ? new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit) : null
        if (!sdp || !this.pc || !this.isCallLive()) break
        if (typeof msg.from === 'string' && !this.peerId) this.peerId = msg.from
        if (msg.kind === 'offer') {
          // A restart offer resets the remote description — candidates
          // arriving mid-restart are buffered until it settles.
          this.remoteDescReady = false
          this.pc.setRemoteDescription(sdp)
            .then(async () => {
              this.remoteDescReady = true
              await this.flushInboundIce()
              const answer = await this.pc!.createAnswer()
              await this.pc!.setLocalDescription(answer)
              this.send({
                type: 'call',
                to: this.peerId ?? msg.from,
                from: this.cfg.userId,
                kind: 'answer',
                iceRestart: true,
                sdp: answer,
              })
            })
            .catch((e) => this.emit('error', { code: 'renegotiate', message: String(e) }))
        } else if (msg.kind === 'answer') {
          this.pc.setRemoteDescription(sdp)
            .then(() => this.flushInboundIce())
            .catch((e) => this.emit('error', { code: 'renegotiate', message: String(e) }))
        }
        break
      }
      case 'hangup':
        this.clearCallTimeout()
        this.clearRingTimeout()
        this.cleanupCall()
        this.setState('ended')
        this.emit('hangup', { reason: asStr(msg.reason) ?? 'remote' })
        setTimeout(() => this.setState('idle'), 2500)
        break
      case 'pong':
        // Heartbeat ack — nothing to do.
        break
      case 'error':
        // Terminal call-setup errors — stop ringing and release the mic.
        if (
          TERMINAL_ERROR_CODES.has(asStr(msg.code) ?? '') &&
          (this.state === 'calling' || this.state === 'incoming' ||
            this.state === 'connecting' || this.state === 'active')
        ) {
          this.clearCallTimeout()
          this.clearRingTimeout()
          this.cleanupCall()
          this.setState('idle')
        }
        this.emit('error', { code: asStr(msg.code) ?? 'error', message: asStr(msg.message) ?? L('call.errUnknown') })
        break
    }
  }

  // ── Call control ───────────────────────────────────────────

  /** Customer: start a call to the agent. Agent: start a call to a customer. */
  async startCall(targetUserId?: string): Promise<void> {
    if (this.state !== 'idle') return
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      })
    } catch {
      this.emit('error', { code: 'mic-denied', message: L('call.errMicDeniedLong') })
      return
    }

    if (!this.registered) {
      await this.waitForRegistered(2000)
    }

    // Agent-initiated calls know their peer up front; customer-initiated
    // calls learn the agent's real userId from the `answer`/`ice` messages.
    this.peerId = this.cfg.role === 'agent' ? (targetUserId ?? null) : null
    this.isOfferer = true

    this.pc = new RTCPeerConnection({
      iceServers: this.cfg.iceServers,
      // Pre-open TURN relay sockets before the SDP exchange — on
      // corporate networks the TURN-over-TLS/TCP-443 handshake takes
      // seconds; starting it up-front keeps "answered → connected"
      // inside the media deadline.
      iceCandidatePoolSize: 2,
    })
    this.setupPeerConnection()

    // Create offer.
    const offer = await this.pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false })
    await this.pc.setLocalDescription(offer)

    const to = this.cfg.role === 'customer' ? 'agent' : (targetUserId ?? '')
    this.send({
      type: 'call',
      to,
      from: this.cfg.userId,
      kind: 'offer',
      sdp: offer,
    })
    this.setState('calling')
    this.startCallTimeout()
  }

  /** Accept an inbound call (agent receiving customer's offer, or vice versa). */
  async acceptCall(remoteOfferSdp: unknown, fromUserId: string): Promise<void> {
    if (this.state !== 'incoming') return
    this.clearRingTimeout()
    this.peerId = fromUserId
    this.isOfferer = false
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      })
    } catch {
      // Mic permission denied AFTER the user pressed Accept. Two things
      // must happen: (1) OUR side learns WHY with actionable guidance;
      // (2) the CALLER learns the pickup failed for a mic reason — not a
      // vague "remote" hangup. Production incident 2026-09-20 (first
      // cross-network test): the agent's mic permission was still
      // un-granted; the auto-hangup reached the customer as `remote` and
      // looked like a network failure. `mic-denied` now rides the hangup
      // frame (allow-listed server-side) and maps to a clear message on
      // both ends.
      this.emit('error', { code: 'mic-denied', message: L('call.errMicDenied') })
      this.hangup('mic-denied')
      return
    }

    if (!this.registered) {
      await this.waitForRegistered(2000)
    }

    this.pc = new RTCPeerConnection({
      iceServers: this.cfg.iceServers,
      iceCandidatePoolSize: 2,
    })
    this.setupPeerConnection()

    await this.pc.setRemoteDescription(new RTCSessionDescription(remoteOfferSdp as RTCSessionDescriptionInit))
    // Remote description settled — apply the caller's candidates that
    // were buffered during the ring (they would otherwise be lost).
    this.remoteDescReady = true
    await this.flushInboundIce()
    const answer = await this.pc.createAnswer()
    await this.pc.setLocalDescription(answer)

    this.send({
      type: 'call',
      to: fromUserId,
      from: this.cfg.userId,
      kind: 'answer',
      sdp: answer,
    })
    this.setState('connecting')
    this.startConnectTimeout()
  }

  /** Reject an inbound call. */
  rejectCall(fromUserId: string): void {
    this.clearRingTimeout()
    this.send({ type: 'hangup', to: fromUserId, reason: 'declined', from: this.cfg.userId })
    this.cleanupCall()
    this.setState('idle')
  }

  /** End the current call. */
  hangup(reason?: 'remote' | 'busy' | 'declined' | 'timeout' | 'mic-denied'): void {
    if (this.state === 'idle') return
    // Route to the peer we actually talked to. `?? 'agent'` covers a
    // customer hanging up before the agent answered (the server resolves
    // 'agent' to the online agent). An AGENT must never send `to: 'agent'` —
    // that id doesn't exist in the hub and the hangup would be dropped.
    this.send({ type: 'hangup', to: this.peerId ?? 'agent', reason, from: this.cfg.userId })
    this.clearCallTimeout()
    this.clearRingTimeout()
    this.cleanupCall()
    this.setState('ended')
    setTimeout(() => this.setState('idle'), 2500)
  }

  /** Toggle mic on/off. Returns new enabled state. */
  toggleMic(): boolean {
    this.micEnabled = !this.micEnabled
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        track.enabled = this.micEnabled
      }
    }
    return this.micEnabled
  }

  get micOn(): boolean { return this.micEnabled }

  // ── Ring / call timeouts ───────────────────────────────────

  /** Outbound call: nobody answered within CALL_TIMEOUT_MS → hang up. */
  private startCallTimeout(): void {
    this.clearCallTimeout()
    this.callTimeoutTimer = setTimeout(() => {
      this.callTimeoutTimer = null
      if (this.state === 'calling') {
        this.hangup('timeout')
        this.emit('error', { code: 'call-timeout', message: L('call.errTimeout') })
      }
    }, CALL_TIMEOUT_MS)
  }

  private clearCallTimeout(): void {
    if (this.callTimeoutTimer) { clearTimeout(this.callTimeoutTimer); this.callTimeoutTimer = null }
  }

  /** Inbound call: not accepted within RING_TIMEOUT_MS → auto-reject busy. */
  private startRingTimeout(): void {
    this.clearRingTimeout()
    this.ringTimeoutTimer = setTimeout(() => {
      this.ringTimeoutTimer = null
      if (this.state === 'incoming') {
        this.send({ type: 'hangup', to: this.peerId ?? '', reason: 'busy', from: this.cfg.userId })
        this.cleanupCall()
        this.setState('idle')
      }
    }, RING_TIMEOUT_MS)
  }

  private clearRingTimeout(): void {
    if (this.ringTimeoutTimer) { clearTimeout(this.ringTimeoutTimer); this.ringTimeoutTimer = null }
  }

  /** Media must connect within CONNECT_TIMEOUT_MS of the SDP exchange —
   * otherwise end the call with a clear network error (both sides). */
  private startConnectTimeout(): void {
    this.clearConnectTimeout()
    this.connectTimeoutTimer = setTimeout(() => {
      this.connectTimeoutTimer = null
      if (!this.mediaConnected && (this.state === 'connecting' || this.state === 'active')) {
        this.emit('error', {
          code: 'media-timeout',
          message:
            L('call.errAudioFailed'),
        })
        this.hangup('timeout')
      }
    }, CONNECT_TIMEOUT_MS)
  }

  private clearConnectTimeout(): void {
    if (this.connectTimeoutTimer) { clearTimeout(this.connectTimeoutTimer); this.connectTimeoutTimer = null }
  }

  // ── Peer connection plumbing ───────────────────────────────

  private setupPeerConnection(): void {
    if (!this.pc || !this.localStream) return
    // Live network-health sampling for the whole life of the call.
    this.startQualitySampler()
    // Add local tracks.
    for (const track of this.localStream.getAudioTracks()) {
      this.pc.addTrack(track, this.localStream)
    }
    // ICE candidates → relay via signaling. Route to the actual peer we're
    // negotiating with (`peerId`). Falling back to the literal 'agent' only
    // makes sense for a customer who hasn't learned the agent's id yet; for
    // an agent, an empty `to` would be rejected by the server, so we send to
    // `peerId` (always set by acceptCall/startCall before ICE flows).
    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        const to = this.peerId ?? (this.cfg.role === 'customer' ? 'agent' : '')
        if (!to) return
        this.sendOrBufferIce(to, ev.candidate)
      }
    }
    // Remote track → attach to audio element.
    this.remoteStream = new MediaStream()
    this.pc.ontrack = (ev) => {
      if (ev.streams && ev.streams[0]) {
        this.remoteStream = ev.streams[0]
      } else if (ev.track && this.remoteStream) {
        this.remoteStream.addTrack(ev.track)
      }
      if (this.remoteAudioElement && this.remoteStream) {
        try { this.remoteAudioElement.srcObject = this.remoteStream } catch { }
        // iOS Safari requires play() within a user gesture.
        try { this.remoteAudioElement.play().catch(() => { }) } catch { }
      }
      if (this.remoteStream) {
        this.emit('remote-stream', { stream: this.remoteStream as MediaStream })
      }
    }
    this.pc.onconnectionstatechange = () => {
      if (this.pc) this.emit('connection-state', { state: this.pc.connectionState })
      if (this.pc?.connectionState === 'connected') {
        this.mediaConnected = true
        this.clearConnectTimeout()
        // The ANSWERING side never receives an `answer` message, so 'connected'
        // is its only signal that the call is live → promote to 'active'.
        if (this.state === 'connecting') {
          this.setState('active')
        }
      }
      if (this.pc?.connectionState === 'failed' || this.pc?.connectionState === 'disconnected') {
        // ICE hiccup — give it a moment to recover, then either restart
        // ICE (once, offerer-only — the office-network case where the
        // media path never came up or died mid-negotiation) or hang up.
        setTimeout(() => {
          if (this.pc && (this.pc.connectionState === 'failed' || this.pc.connectionState === 'disconnected')) {
            if (this.isOfferer && this.iceRestarts < 1 && this.isCallLive()) {
              void this.restartIce()
            } else {
              this.hangup()
            }
          }
        }, 3000)
      }
    }
    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc?.iceConnectionState
      if (state === 'connected' || state === 'completed') {
        this.mediaConnected = true
        this.clearConnectTimeout()
        if (this.state === 'connecting') {
          this.setState('active')
        }
      }
    }
  }

  /** Offerer-only ICE restart: re-offer with `iceRestart: true`, relayed
   * by the server as a `renegotiate` frame; the peer re-answers on its
   * EXISTING peer connection. Fresh candidates + a fresh media deadline —
   * the recovery path for restrictive NATs / corporate firewalls / IP
   * churn that invalidated the original candidate set. */
  private async restartIce(): Promise<void> {
    if (!this.pc || !this.isOfferer) return
    this.iceRestarts++
    this.clearConnectTimeout()
    try {
      const offer = await this.pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
        iceRestart: true,
      })
      await this.pc.setLocalDescription(offer)
      const to = this.peerId ?? (this.cfg.role === 'customer' ? 'agent' : '')
      if (!to) throw new Error('no peer to restart toward')
      this.send({
        type: 'call',
        to,
        from: this.cfg.userId,
        kind: 'offer',
        iceRestart: true,
        sdp: offer,
      })
      this.startConnectTimeout()
      this.emit('ice-restart', { attempts: this.iceRestarts })
    } catch (e) {
      this.emit('error', { code: 'ice-restart', message: String(e) })
      this.hangup()
    }
  }

  private cleanupCall(): void {
    if (this.pc) {
      try { this.pc.close() } catch { }
      this.pc = null
    }
    if (this.localStream) {
      for (const t of this.localStream.getAudioTracks()) { try { t.stop() } catch { } }
      this.localStream = null
    }
    this.remoteStream = null
    this.micEnabled = true
    this.peerId = null
    this.isOfferer = false
    this.iceRestarts = 0
    this.pendingIce = []
    this.inboundIce = []
    this.remoteDescReady = false
    this.clearCallTimeout()
    this.clearRingTimeout()
    this.stopQualitySampler()
    if (this.remoteAudioElement) {
      try { this.remoteAudioElement.srcObject = null } catch { }
    }
  }
}
