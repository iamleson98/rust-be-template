/**
 * WebRTC audio-call client: 1-1 calls between a customer and the support
 * agent (or an agent and a customer), signalled over the Rust `/ws-call`
 * endpoint. The endpoint only relays SDP and ICE; audio flows peer to peer.
 *
 *   Browser A ──WS──► /ws-call ◄──WS── Browser B
 *       RTCPeerConnection ◄── audio ──► RTCPeerConnection
 *
 * - Auth: the `vx_access` cookie rides the WS upgrade; the server takes
 *   the user id from the verified token, never from a payload.
 * - ICE servers: public STUN by default; the server pushes its STUN/TURN
 *   config in the `registered` frame so credentials never travel over an
 *   unauthenticated endpoint.
 * - Mobile: `getUserMedia` needs HTTPS (or localhost) and iOS needs the
 *   remote `<audio autoplay playsInline>` to be played from a user gesture.
 * - Resilience for office NATs / IP churn: outbound ICE candidates are
 *   buffered while the socket is down and re-sent on reconnect; inbound
 *   ones are buffered until the peer connection and remote description
 *   exist; and the original offerer retries once with an ICE restart
 *   (`renegotiate` frames) when the media path fails.
 */
import { tSync } from '@/lib/i18n'
import { classifyQuality, summarizeStats, type QualityStats } from './call-quality'
import { Emitter } from './emitter'
import { SignalSocket } from './signal-socket'

export type { QualityLevel, QualityStats } from './call-quality'

export type CallRole = 'customer' | 'agent'

export type CallState =
  | 'idle'
  | 'calling' // outbound: waiting for an answer
  | 'incoming' // inbound: ringing
  | 'connecting' // answered, ICE in progress
  | 'active'
  | 'ended' // shown briefly as "call ended"

export interface IceServerConfig {
  urls: string | string[]
  username?: string
  credential?: string
}

export interface AudioCallConfig {
  signalingUrl: string
  userId: string
  role: CallRole
  /** Chat channel the call belongs to (context only). */
  channelId?: string
  /** STUN/TURN servers; defaults to Google STUN. */
  iceServers?: IceServerConfig[]
}

export interface AudioCallEventMap {
  state: CallState
  registered: Record<string, unknown>
  presence: { onlineAgents: number; agentInCall?: boolean; agentsAvailable?: boolean }
  /** The caller's identity comes from the backend's verified session, never the client. */
  incoming: {
    from: string
    channelId?: string
    callerName?: string
    callerAvatar?: string
    sdp: RTCSessionDescriptionInit
  }
  error: { code: string; message: string }
  hangup: { reason: string }
  _close: { code: number; reason: string }
  'remote-stream': { stream: MediaStream }
  'connection-state': { state: RTCPeerConnectionState }
  'ice-restart': { attempts: number }
  quality: QualityStats & { level: ReturnType<typeof classifyQuality> }
}

type HangupReason = 'remote' | 'busy' | 'declined' | 'timeout' | 'mic-denied'

const DEFAULT_ICE_SERVERS: IceServerConfig[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
]

const CALL_TIMEOUT_MS = 30_000 // outbound call rings this long
const RING_TIMEOUT_MS = 30_000 // inbound call rings this long before auto-reject
/** Media must connect this soon after the SDP exchange (both sides), else a clear network error. */
const CONNECT_TIMEOUT_MS = 20_000
const QUALITY_POLL_MS = 2500
const MAX_PENDING_ICE = 64
const MAX_INBOUND_ICE = 128
const REGISTER_WAIT_MS = 2000
const ENDED_LINGER_MS = 2500

/** Setup errors from the server's session guard: ringing on would be pointless. */
const TERMINAL_ERROR_CODES = new Set([
  'no-agent',
  'agents-busy',
  'peer-unavailable',
  'customer-busy',
  'agent-busy',
  'peer-busy',
  'no-session',
])

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  video: false,
}

const asNum = (v: unknown, fallback = 0) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback
const asStr = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/** One re-armable timeout. */
class Timer {
  private id: ReturnType<typeof setTimeout> | null = null
  set(ms: number, fn: () => void): void {
    this.clear()
    this.id = setTimeout(() => {
      this.id = null
      fn()
    }, ms)
  }
  clear(): void {
    if (this.id) clearTimeout(this.id)
    this.id = null
  }
}

export class AudioCallClient {
  state: CallState = 'idle'
  onlineAgents = 0
  remoteAudioElement: HTMLAudioElement | null = null

  private readonly cfg: AudioCallConfig
  private readonly events = new Emitter<AudioCallEventMap>()
  private readonly socket: SignalSocket
  private readonly callTimer = new Timer()
  private readonly ringTimer = new Timer()
  private readonly connectTimer = new Timer()
  private qualityTimer: ReturnType<typeof setInterval> | null = null

  private pc: RTCPeerConnection | null = null
  private localStream: MediaStream | null = null
  private remoteStream: MediaStream | null = null
  private micEnabled = true
  private disposed = false
  private mediaConnected = false

  /** The peer being negotiated with, learned from `incoming.from` / `answer.from` / `ice.from`
   *  (or the explicit target of an agent-initiated call); hangup and ICE are routed to it. */
  private peerId: string | null = null
  /** Only the original offerer may drive an ICE restart (WebRTC glare rule). */
  private isOfferer = false
  /** One restart per call: a second one on the same dead path is noise. */
  private iceRestarts = 0

  /** Candidates produced while the socket was down; a lost one leaves the peer with an
   *  incomplete set ("stuck on connecting"), so they are re-sent on reconnect. */
  private pendingIce: Record<string, unknown>[] = []
  /** Inbound candidates that arrived before the peer connection or the remote description
   *  existed; browsers never re-trickle, so dropping them breaks strict-NAT calls. */
  private inboundIce: RTCIceCandidateInit[] = []
  private remoteDescReady = false

  private registered = false
  private registeredWaiters: Array<() => void> = []

  constructor(cfg: AudioCallConfig) {
    this.cfg = { ...cfg, iceServers: cfg.iceServers ?? DEFAULT_ICE_SERVERS }
    this.socket = new SignalSocket(cfg.signalingUrl, {
      open: () => {
        this.socket.send({
          type: 'register',
          role: cfg.role,
          userId: cfg.userId,
          channelId: cfg.channelId,
        })
        // Candidates buffered while the socket was down ride along.
        for (const msg of this.pendingIce.splice(0)) this.socket.send(msg)
      },
      message: (msg) => this.handleSignal(msg),
      close: (code, reason) => this.events.emit('_close', { code, reason }),
      error: (code, message) => this.events.emit('error', { code, message }),
    })
  }

  on<K extends keyof AudioCallEventMap>(event: K, handler: (data: AudioCallEventMap[K]) => void) {
    return this.events.on(event, handler)
  }

  connect(): void {
    this.socket.connect()
  }

  get micOn(): boolean {
    return this.micEnabled
  }

  dispose(): void {
    this.disposed = true
    this.stopQualitySampler()
    for (const timer of [this.callTimer, this.ringTimer, this.connectTimer]) timer.clear()
    this.hangup()
    this.socket.close()
    this.events.clear()
  }

  // ── Call control ───────────────────────────────────────────

  /** Customer: call the agent. Agent: call `targetUserId`. */
  async startCall(targetUserId?: string): Promise<void> {
    if (this.state !== 'idle') return
    if (!(await this.openMic('call.errMicDeniedLong'))) return
    await this.waitForRegistered()

    // Agent-initiated calls know their peer up front; a customer learns the
    // agent's real id from the `answer` / `ice` frames.
    this.peerId = this.cfg.role === 'agent' ? (targetUserId ?? null) : null
    this.isOfferer = true
    this.createPeerConnection()

    const offer = await this.pc!.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false,
    })
    await this.pc!.setLocalDescription(offer)
    this.socket.send({
      type: 'call',
      to: this.cfg.role === 'customer' ? 'agent' : (targetUserId ?? ''),
      from: this.cfg.userId,
      kind: 'offer',
      sdp: offer,
    })
    this.setState('calling')
    this.callTimer.set(CALL_TIMEOUT_MS, () => {
      if (this.state !== 'calling') return
      this.hangup('timeout')
      this.events.emit('error', { code: 'call-timeout', message: tSync('call.errTimeout') })
    })
  }

  /** Accept the inbound call whose offer arrived in the `incoming` event. */
  async acceptCall(remoteOfferSdp: unknown, fromUserId: string): Promise<void> {
    if (this.state !== 'incoming') return
    this.ringTimer.clear()
    this.peerId = fromUserId
    this.isOfferer = false
    if (!(await this.openMic('call.errMicDenied', 'mic-denied'))) return
    await this.waitForRegistered()
    this.createPeerConnection()

    await this.pc!.setRemoteDescription(
      new RTCSessionDescription(remoteOfferSdp as RTCSessionDescriptionInit),
    )
    // Apply the caller's candidates that trickled in during the ring.
    this.remoteDescReady = true
    await this.flushInboundIce()
    const answer = await this.pc!.createAnswer()
    await this.pc!.setLocalDescription(answer)

    this.socket.send({
      type: 'call',
      to: fromUserId,
      from: this.cfg.userId,
      kind: 'answer',
      sdp: answer,
    })
    this.setState('connecting')
    this.startConnectTimeout()
  }

  rejectCall(fromUserId: string): void {
    this.ringTimer.clear()
    this.socket.send({ type: 'hangup', to: fromUserId, reason: 'declined', from: this.cfg.userId })
    this.cleanupCall()
    this.setState('idle')
  }

  hangup(reason?: HangupReason): void {
    if (this.state === 'idle') return
    // 'agent' covers a customer hanging up before anyone answered; an agent
    // always has a real peer id (the hub would drop `to: 'agent'`).
    this.socket.send({ type: 'hangup', to: this.peerId ?? 'agent', reason, from: this.cfg.userId })
    this.callTimer.clear()
    this.ringTimer.clear()
    this.cleanupCall()
    this.endCall()
  }

  /** Toggle the mic; returns whether it is now on. */
  toggleMic(): boolean {
    this.micEnabled = !this.micEnabled
    for (const track of this.localStream?.getAudioTracks() ?? []) track.enabled = this.micEnabled
    return this.micEnabled
  }

  // ── Internals ──────────────────────────────────────────────

  private setState(state: CallState): void {
    this.state = state
    this.events.emit('state', state)
  }

  /** Show "ended" briefly, then go idle. */
  private endCall(): void {
    this.setState('ended')
    setTimeout(() => this.setState('idle'), ENDED_LINGER_MS)
  }

  private isCallLive(): boolean {
    return this.state !== 'idle' && this.state !== 'ended'
  }

  /** The id a signalling frame to the peer is addressed to ('' when unknown). */
  private peerAddress(): string {
    return this.peerId ?? (this.cfg.role === 'customer' ? 'agent' : '')
  }

  /** Ask for the microphone. On refusal tells the user why (and, after Accept, the caller too). */
  private async openMic(deniedKey: string, hangupReason?: HangupReason): Promise<boolean> {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS)
      return true
    } catch {
      this.events.emit('error', { code: 'mic-denied', message: tSync(deniedKey) })
      // The caller must learn the pickup failed for a mic reason, not a vague "remote" hangup.
      if (hangupReason) this.hangup(hangupReason)
      return false
    }
  }

  private waitForRegistered(timeoutMs = REGISTER_WAIT_MS): Promise<void> {
    if (this.registered) return Promise.resolve()
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        this.registeredWaiters = this.registeredWaiters.filter((w) => w !== done)
        resolve()
      }, timeoutMs)
      this.registeredWaiters.push(done)
    })
  }

  private startConnectTimeout(): void {
    this.connectTimer.set(CONNECT_TIMEOUT_MS, () => {
      if (!this.mediaConnected && (this.state === 'connecting' || this.state === 'active')) {
        this.events.emit('error', { code: 'media-timeout', message: tSync('call.errAudioFailed') })
        this.hangup('timeout')
      }
    })
  }

  // ── Signalling ─────────────────────────────────────────────

  private handleSignal(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case 'registered':
        return this.onRegistered(msg)
      case 'ice-servers':
        // Fresh TURN credentials while the socket stays open; calls started from now use them.
        if (Array.isArray(msg.iceServers) && msg.iceServers.length > 0)
          this.cfg.iceServers = msg.iceServers
        return
      case 'presence':
        this.onlineAgents = asNum(msg.onlineAgents)
        return this.events.emit('presence', { onlineAgents: this.onlineAgents })
      case 'incoming':
        return this.onIncoming(msg)
      case 'answer':
        return this.onAnswer(msg)
      case 'ice':
        return this.onIce(msg)
      case 'renegotiate':
        return this.onRenegotiate(msg)
      case 'hangup':
        this.callTimer.clear()
        this.ringTimer.clear()
        this.cleanupCall()
        this.endCall()
        return this.events.emit('hangup', { reason: asStr(msg.reason) ?? 'remote' })
      case 'error':
        return this.onServerError(msg)
    }
  }

  private onRegistered(msg: Record<string, unknown>): void {
    this.registered = true
    this.onlineAgents = asNum(msg.onlineAgents)
    // Server-provided STUN/TURN applies to every connection created from now on.
    if (Array.isArray(msg.iceServers) && msg.iceServers.length > 0)
      this.cfg.iceServers = msg.iceServers
    for (const resolve of this.registeredWaiters.splice(0)) resolve()

    // A socket that dropped mid-call re-registers and the server says whether the session
    // still exists. Gone + a live local call = zombie: the hangup went to the other side.
    // (A blip that reconnects with the session alive keeps the call: audio is peer to peer.)
    if (!this.disposed && this.isCallLive() && !msg.activeCall) {
      for (const timer of [this.callTimer, this.ringTimer, this.connectTimer]) timer.clear()
      this.cleanupCall()
      this.endCall()
      this.events.emit('error', { code: 'call-gone', message: tSync('call.ended') })
    }
    this.events.emit('registered', msg)
    this.events.emit('presence', { onlineAgents: this.onlineAgents })
  }

  private onIncoming(msg: Record<string, unknown>): void {
    // One call at a time: answer `busy` at once instead of ringing into a void.
    if (this.state !== 'idle' || this.pc) {
      this.socket.send({
        type: 'hangup',
        to: asStr(msg.from) ?? '',
        reason: 'busy',
        from: this.cfg.userId,
      })
      return
    }
    this.peerId = asStr(msg.from)
    this.setState('incoming')
    this.events.emit('incoming', {
      from: asStr(msg.from) ?? '',
      channelId: asStr(msg.channelId) ?? undefined,
      callerName: asStr(msg.callerName) ?? undefined,
      callerAvatar: asStr(msg.callerAvatar) ?? undefined,
      sdp: msg.sdp as RTCSessionDescriptionInit,
    })
    this.ringTimer.set(RING_TIMEOUT_MS, () => {
      if (this.state !== 'incoming') return
      this.socket.send({
        type: 'hangup',
        to: this.peerId ?? '',
        reason: 'busy',
        from: this.cfg.userId,
      })
      this.cleanupCall()
      this.setState('idle')
    })
  }

  private onAnswer(msg: Record<string, unknown>): void {
    this.callTimer.clear()
    if (typeof msg.from === 'string') this.peerId = msg.from
    if (!this.pc || !msg.sdp) return
    this.pc
      .setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit))
      .then(() => {
        // The answerer's candidates may have arrived while this was settling.
        this.remoteDescReady = true
        return this.flushInboundIce()
      })
      .then(() => this.setState('active'))
      .catch((e) => this.events.emit('error', { code: 'set-remote-desc', message: String(e) }))
    // The caller is already 'active', but media may never connect.
    this.startConnectTimeout()
  }

  private onIce(msg: Record<string, unknown>): void {
    if (typeof msg.from === 'string' && !this.peerId) this.peerId = msg.from
    const candidate = msg.candidate as RTCIceCandidateInit | undefined
    if (!candidate) return
    if (this.pc && this.remoteDescReady) {
      this.pc
        .addIceCandidate(new RTCIceCandidate(candidate))
        .catch((e) => this.events.emit('error', { code: 'add-ice', message: String(e) }))
    } else if (this.isCallLive() && this.inboundIce.length < MAX_INBOUND_ICE) {
      this.inboundIce.push(candidate)
    }
  }

  /** ICE restart from the original offerer: re-offer on the EXISTING connection, never re-ring. */
  private onRenegotiate(msg: Record<string, unknown>): void {
    const sdp = msg.sdp ? new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit) : null
    const pc = this.pc
    if (!sdp || !pc || !this.isCallLive()) return
    if (typeof msg.from === 'string' && !this.peerId) this.peerId = msg.from
    const fail = (e: unknown) =>
      this.events.emit('error', { code: 'renegotiate', message: String(e) })

    if (msg.kind === 'offer') {
      // Candidates arriving mid-restart wait until the new description settles.
      this.remoteDescReady = false
      pc.setRemoteDescription(sdp)
        .then(async () => {
          this.remoteDescReady = true
          await this.flushInboundIce()
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          this.socket.send({
            type: 'call',
            to: this.peerId ?? msg.from,
            from: this.cfg.userId,
            kind: 'answer',
            iceRestart: true,
            sdp: answer,
          })
        })
        .catch(fail)
    } else if (msg.kind === 'answer') {
      pc.setRemoteDescription(sdp)
        .then(() => this.flushInboundIce())
        .catch(fail)
    }
  }

  private onServerError(msg: Record<string, unknown>): void {
    if (TERMINAL_ERROR_CODES.has(asStr(msg.code) ?? '') && this.isCallLive()) {
      this.callTimer.clear()
      this.ringTimer.clear()
      this.cleanupCall()
      this.setState('idle')
    }
    this.events.emit('error', {
      code: asStr(msg.code) ?? 'error',
      message: asStr(msg.message) ?? tSync('call.errUnknown'),
    })
  }

  // ── ICE buffering ──────────────────────────────────────────

  private sendOrBufferIce(to: string, candidate: unknown): void {
    const frame = { type: 'call', to, from: this.cfg.userId, kind: 'ice', candidate }
    if (this.socket.send(frame)) return
    if (this.isCallLive() && this.pendingIce.length < MAX_PENDING_ICE) this.pendingIce.push(frame)
  }

  /** Apply buffered inbound candidates; stale or duplicate ones fail harmlessly. */
  private async flushInboundIce(): Promise<void> {
    if (!this.pc) return
    for (const candidate of this.inboundIce.splice(0)) {
      if (!this.pc) return
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate))
      } catch {
        // stale or duplicate
      }
    }
  }

  // ── Peer connection ────────────────────────────────────────

  private createPeerConnection(): void {
    // Pre-opening TURN relay sockets keeps "answered → connected" inside the
    // media deadline on corporate networks, where TURN-over-TLS takes seconds.
    const pc = new RTCPeerConnection({ iceServers: this.cfg.iceServers, iceCandidatePoolSize: 2 })
    this.pc = pc
    this.startQualitySampler()
    for (const track of this.localStream?.getAudioTracks() ?? [])
      pc.addTrack(track, this.localStream!)

    pc.onicecandidate = (ev) => {
      const to = this.peerAddress()
      if (ev.candidate && to) this.sendOrBufferIce(to, ev.candidate)
    }

    this.remoteStream = new MediaStream()
    pc.ontrack = (ev) => {
      if (ev.streams[0]) this.remoteStream = ev.streams[0]
      else if (this.remoteStream) this.remoteStream.addTrack(ev.track)
      const audio = this.remoteAudioElement
      if (audio && this.remoteStream) {
        try {
          audio.srcObject = this.remoteStream
          audio.play().catch(() => {}) // iOS only plays inside a user gesture
        } catch {
          // element detached
        }
      }
      if (this.remoteStream) this.events.emit('remote-stream', { stream: this.remoteStream })
    }

    pc.onconnectionstatechange = () => {
      this.events.emit('connection-state', { state: pc.connectionState })
      if (pc.connectionState === 'connected') this.onMediaConnected()
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        // Give ICE a moment to recover, then restart once (offerer only) or hang up.
        setTimeout(() => {
          const stillDown = this.pc && ['failed', 'disconnected'].includes(this.pc.connectionState)
          if (!stillDown) return
          if (this.isOfferer && this.iceRestarts < 1 && this.isCallLive()) void this.restartIce()
          else this.hangup()
        }, 3000)
      }
    }
    pc.oniceconnectionstatechange = () => {
      const ice = this.pc?.iceConnectionState
      if (ice === 'connected' || ice === 'completed') this.onMediaConnected()
    }
  }

  /** Media is flowing. The answering side never gets an `answer`, so this is its signal to go 'active'. */
  private onMediaConnected(): void {
    this.mediaConnected = true
    this.connectTimer.clear()
    if (this.state === 'connecting') this.setState('active')
  }

  /** Re-offer with `iceRestart` for fresh candidates and a fresh media deadline. */
  private async restartIce(): Promise<void> {
    if (!this.pc || !this.isOfferer) return
    this.iceRestarts++
    this.connectTimer.clear()
    try {
      const offer = await this.pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
        iceRestart: true,
      })
      await this.pc.setLocalDescription(offer)
      const to = this.peerAddress()
      if (!to) throw new Error('no peer to restart toward')
      this.socket.send({
        type: 'call',
        to,
        from: this.cfg.userId,
        kind: 'offer',
        iceRestart: true,
        sdp: offer,
      })
      this.startConnectTimeout()
      this.events.emit('ice-restart', { attempts: this.iceRestarts })
    } catch (e) {
      this.events.emit('error', { code: 'ice-restart', message: String(e) })
      this.hangup()
    }
  }

  // ── Quality ────────────────────────────────────────────────

  private startQualitySampler(): void {
    this.stopQualitySampler()
    this.qualityTimer = setInterval(() => void this.sampleQuality(), QUALITY_POLL_MS)
  }

  private stopQualitySampler(): void {
    if (this.qualityTimer) clearInterval(this.qualityTimer)
    this.qualityTimer = null
  }

  private async sampleQuality(): Promise<void> {
    if (!this.pc || this.disposed) return
    try {
      const sample = summarizeStats(await this.pc.getStats())
      this.events.emit('quality', { ...sample, level: classifyQuality(sample) })
    } catch {
      // getStats can fail briefly during ICE restarts
    }
  }

  // ── Teardown ───────────────────────────────────────────────

  private cleanupCall(): void {
    try {
      this.pc?.close()
    } catch {
      // already closed
    }
    this.pc = null
    for (const track of this.localStream?.getAudioTracks() ?? []) {
      try {
        track.stop()
      } catch {
        // already stopped
      }
    }
    this.localStream = null
    this.remoteStream = null
    this.micEnabled = true
    this.peerId = null
    this.isOfferer = false
    this.iceRestarts = 0
    this.mediaConnected = false
    this.pendingIce = []
    this.inboundIce = []
    this.remoteDescReady = false
    this.callTimer.clear()
    this.ringTimer.clear()
    this.connectTimer.clear()
    this.stopQualitySampler()
    if (this.remoteAudioElement) {
      try {
        this.remoteAudioElement.srcObject = null
      } catch {
        // element detached
      }
    }
  }
}
