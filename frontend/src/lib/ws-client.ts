/**
 * Lightweight native WebSocket client — replaces `socket.io-client`.
 *
 * Connects to the Rust (Axum + tokio-tungstenite) backend at `/ws` on the
 * same origin the SPA was served from. Uses the browser's built-in
 * `WebSocket` API — zero dependencies, ~1 KB, no engine.io polling overhead.
 *
 * Protocol: a tiny JSON envelope `{"type":"<event>", ...}`.
 *
 * Lifecycle events (prefixed with `_` to avoid clashing with server events):
 *   `_open`   — connection established
 *   `_close`  — connection closed `{ code, reason, everOpened }`
 *   `_error`  — socket error
 *   `_giveup` — max reconnect attempts exhausted
 *
 * Server events: `hello`, `history`, `message`, `typing`, `presence`,
 * `employee_presence`, `waiting_for_agent`, `system`, `error`, `pong`.
 */

type Handler = (data: Record<string, unknown>) => void

/**
 * Build the WebSocket URL for the Rust chat backend.
 *
 * The SPA is served from the Rust backend (default :8080), so the WS
 * endpoint is on the same host/port as the page — just upgrade to ws(s).
 *
 * Auth: the Rust `/ws` handler accepts `?token=<jwt>` OR (for `/ws-call`)
 * the `access_token` cookie. We pass an explicit `token` when one is
 * available, but the browser also sends the httpOnly cookie automatically
 * on the WS upgrade request (same-origin), so connecting without a token
 * works for users who logged in via `/api/auth/login`.
 */
function buildWsUrl(token?: string | null): string {
  if (typeof window === 'undefined') {
    // SSR / prerender — emit a placeholder URL; never actually connects.
    const base = 'ws://localhost:8080/ws'
    return token ? `${base}?token=${encodeURIComponent(token)}` : base
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const base = `${proto}//${window.location.host}/ws`
  return token ? `${base}?token=${encodeURIComponent(token)}` : base
}

export class WsClient {
  private ws: WebSocket | null = null
  private readonly handlers = new Map<string, Set<Handler>>()
  private url: string
  private reconnectAttempts = 0
  private readonly maxReconnect = 8
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private everOpened = false
  /** Public read-only connection flag (mirrors `readyState === OPEN`). */
  public connected = false
  /** Was the connection paused by the OS backgrounding the tab? */
  private pausedByVisibility = false
  /** Bound online listener (kept so we can remove it on dispose). */
  private readonly onlineListener = (): void => {
    if (this.disposed) return
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.reconnectAttempts = 0
    this.connect()
  }
  /** visibilitychange listener — mobile browsers freeze WS in background
   * tabs; reconnect immediately when the page becomes visible again. */
  private readonly visibilityListener = (): void => {
    if (this.disposed) return
    if (document.visibilityState === 'visible') {
      if (this.pausedByVisibility || !this.connected) {
        this.pausedByVisibility = false
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer)
          this.reconnectTimer = null
        }
        this.reconnectAttempts = 0
        this.connect()
      } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Socket looks open — send a ping to verify liveness.
        this.send('ping', { __client_ts: Date.now() })
      }
    } else {
      this.pausedByVisibility = true
    }
  }
  /** pagehide listener — close the socket cleanly on iOS app-switch so
   * the server doesn't wait for the TCP keepalive timeout. */
  private readonly pagehideListener = (): void => {
    if (this.disposed) return
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.close(1001, 'pagehide')
      } catch {
        // noop
      }
    }
  }

  constructor(token?: string | null) {
    this.url = buildWsUrl(token)
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onlineListener)
      document.addEventListener('visibilitychange', this.visibilityListener)
      window.addEventListener('pagehide', this.pagehideListener)
    }
    this.connect()
  }

  private connect(): void {
    if (this.disposed) return
    try {
      this.ws = new WebSocket(this.url)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws.onopen = () => {
      this.connected = true
      this.everOpened = true
      this.reconnectAttempts = 0
      this.dispatch('_open', {})
    }

    this.ws.onmessage = (ev: MessageEvent) => {
      // Only text frames are used by the chat protocol.
      if (typeof ev.data !== 'string') return
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      const ty = typeof msg.type === 'string' ? (msg.type as string) : ''
      if (ty) this.dispatch(ty, msg)
      // Always fire `_message` so callers can observe raw traffic if needed.
      this.dispatch('_message', msg)
    }

    this.ws.onclose = (ev: CloseEvent) => {
      this.connected = false
      this.dispatch('_close', {
        code: ev.code,
        reason: ev.reason,
        everOpened: this.everOpened,
      })
      // Pass the close event so scheduleReconnect can honour server-initiated
      // slow-down codes (1008 policy / 1013 try-again-later / 1011 server error)
      // with a longer backoff window.
      if (!this.disposed) this.scheduleReconnect(ev)
    }

    this.ws.onerror = () => {
      this.dispatch('_error', {})
    }
  }

  private scheduleReconnect(closeEvent?: { code?: number; reason?: string }): void {
    if (this.disposed) return
    if (this.reconnectAttempts >= this.maxReconnect) {
      this.dispatch('_giveup', { everOpened: this.everOpened })
      return
    }
    this.reconnectAttempts++
    // Exponential backoff with FULL JITTER: delay = random(0, min(base * 2^n, cap)).
    //
    // The previous linear backoff (1.5s, 3s, 4.5s, 6s, 7.5s, 8s, 8s, 8s) caused
    // a thundering herd: if the backend restarted, every connected client
    // reconnected at the exact same offsets. Jitter spreads reconnects across
    // the backoff window so the server's accept() queue doesn't get hammered.
    //
    // Caps at 30s so a long network blip doesn't strand the client for minutes.
    const base = 1000
    const cap = 30_000

    // ── Server-initiated close codes that warrant a LONGER backoff ────────
    // These indicate the server is explicitly asking us to slow down, so we
    // skip the short end of the jitter window and reconnect closer to the cap.
    //   1008 — Policy Violation (e.g. global connection cap hit)
    //   1013 — Try Again Later (server overload / restarting)
    //   1011 — Internal Server Error (transient; don't hammer)
    const SLOW_DOWN_CODES = new Set([1008, 1011, 1013])
    const slowDown = closeEvent?.code !== undefined && SLOW_DOWN_CODES.has(closeEvent.code)

    const expo = Math.min(base * 2 ** this.reconnectAttempts, cap)
    // Full jitter: [0, expo). For slow-down codes, use [expo*0.6, expo) so we
    // don't retry in the first 60% of the window — gives the server room.
    const delay = slowDown
      ? expo * 0.6 + Math.random() * expo * 0.4
      : Math.random() * expo
    this.reconnectTimer = setTimeout(() => this.connect(), delay)
  }

  /** Force an immediate reconnect (e.g. after re-fetching a fresh token). */
  reconnectNow(token?: string): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.reconnectAttempts = 0
    this.everOpened = false
    if (this.ws) {
      this.stripHandlers(this.ws)
      try {
        this.ws.close()
      } catch {
        /* noop */
      }
      this.ws = null
    }
    if (token) {
      this.url = buildWsUrl(token)
    }
    this.connect()
  }

  private stripHandlers(ws: WebSocket): void {
    ws.onopen = null
    ws.onmessage = null
    ws.onclose = null
    ws.onerror = null
  }

  private dispatch(type: string, data: Record<string, unknown>): void {
    const set = this.handlers.get(type)
    if (!set) return
    for (const h of set) {
      try {
        h(data)
      } catch (e) {
        console.error('[WsClient] handler error', type, e)
      }
    }
  }

  /** Subscribe to a server event (or a `_`-prefixed lifecycle event). */
  on(type: string, handler: Handler): this {
    let set = this.handlers.get(type)
    if (!set) {
      set = new Set()
      this.handlers.set(type, set)
    }
    set.add(handler)
    return this
  }

  /** Unsubscribe from a server event. */
  off(type: string, handler: Handler): this {
    this.handlers.get(type)?.delete(handler)
    return this
  }

  /** Send a JSON envelope `{"type":<type>, ...data}`. Returns false if not open. */
  send(type: string, data: Record<string, unknown> = {}): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    try {
      this.ws.send(JSON.stringify({ type, ...data }))
      return true
    } catch {
      return false
    }
  }

  /** Cleanly close the socket and stop reconnecting. */
  close(): void {
    this.disposed = true
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onlineListener)
      document.removeEventListener('visibilitychange', this.visibilityListener)
      window.removeEventListener('pagehide', this.pagehideListener)
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.stripHandlers(this.ws)
      try {
        this.ws.close()
      } catch {
        /* noop */
      }
      this.ws = null
    }
    this.connected = false
    this.handlers.clear()
  }
}
