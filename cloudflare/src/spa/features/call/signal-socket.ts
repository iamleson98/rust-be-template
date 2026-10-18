const HEARTBEAT_MS = 25_000
const MAX_RECONNECTS = 5
/** Close code for callers outside the countries calls are offered in: reconnecting cannot help. */
export const REGION_BLOCKED_CLOSE = 4403

export interface SignalSocketEvents {
  /** Socket (re)opened. */
  open(): void
  message(msg: Record<string, unknown>): void
  close(code: number, reason: string): void
  error(code: string, message: string): void
}

/** The `/ws-call` signalling socket: JSON frames, heartbeat, and reconnect with jittered backoff. */
export class SignalSocket {
  private ws: WebSocket | null = null
  private attempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private disposed = false

  constructor(
    private readonly url: string,
    private readonly events: SignalSocketEvents,
  ) {}

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  connect(): void {
    if (this.disposed) return
    const state = this.ws?.readyState
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return

    try {
      this.ws = new WebSocket(this.url)
    } catch (e) {
      this.events.error('ws-failed', String(e))
      this.scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      this.attempts = 0
      this.events.open()
      this.stopHeartbeat()
      this.heartbeatTimer = setInterval(() => this.send({ type: 'heartbeat' }), HEARTBEAT_MS)
    }
    this.ws.onmessage = (ev) => {
      try {
        const msg: unknown = JSON.parse(ev.data)
        if (typeof msg === 'object' && msg !== null)
          this.events.message(msg as Record<string, unknown>)
      } catch {
        // not JSON: ignore
      }
    }
    this.ws.onclose = (ev) => {
      this.stopHeartbeat()
      this.events.close(ev.code, ev.reason)
      if (!this.disposed && this.attempts < MAX_RECONNECTS && ev.code !== REGION_BLOCKED_CLOSE)
        this.scheduleReconnect()
    }
    this.ws.onerror = () => this.events.error('ws-error', 'WebSocket error')
  }

  /** Send a frame; false when the socket is not open. */
  send(msg: unknown): boolean {
    if (!this.isOpen) return false
    try {
      this.ws?.send(JSON.stringify(msg))
      return true
    } catch {
      return false
    }
  }

  close(): void {
    this.disposed = true
    this.stopHeartbeat()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    try {
      this.ws?.close()
    } catch {
      // already closed
    }
    this.ws = null
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    this.attempts++
    const ceiling = Math.min(15_000, 500 * 2 ** this.attempts)
    this.reconnectTimer = setTimeout(
      () => {
        this.reconnectTimer = null
        this.connect()
      },
      Math.floor(Math.random() * ceiling),
    )
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }
}
