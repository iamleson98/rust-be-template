/**
 * The call client against fake WebSocket / RTCPeerConnection / mic: the
 * signalling frames it sends, the state machine, ICE buffering and the
 * session reconciliation after a reconnect.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioCallClient, type CallState } from '../audio-call-client'

class FakeSocket {
  static OPEN = 1
  static CONNECTING = 0
  static instances: FakeSocket[] = []
  readyState = FakeSocket.CONNECTING
  sent: Record<string, unknown>[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: ((ev: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) {
    FakeSocket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close() {}
  // test controls
  open() {
    this.readyState = FakeSocket.OPEN
    this.onopen?.()
  }
  drop(code = 1006, reason = '') {
    this.readyState = 3
    this.onclose?.({ code, reason })
  }
  receive(msg: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
  frames(type: string, kind?: string) {
    return this.sent.filter((m) => m.type === type && (kind === undefined || m.kind === kind))
  }
}

class FakePeer {
  static last: FakePeer
  connectionState: RTCPeerConnectionState = 'new'
  iceConnectionState: RTCIceConnectionState = 'new'
  remote: unknown = null
  candidates: unknown[] = []
  closed = false
  onicecandidate: ((ev: { candidate: unknown }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  oniceconnectionstatechange: (() => void) | null = null
  ontrack: unknown = null
  constructor() {
    FakePeer.last = this
  }
  addTrack() {}
  async createOffer() {
    return { type: 'offer', sdp: 'offer-sdp' }
  }
  async createAnswer() {
    return { type: 'answer', sdp: 'answer-sdp' }
  }
  async setLocalDescription() {}
  async setRemoteDescription(sdp: unknown) {
    this.remote = sdp
  }
  async addIceCandidate(c: unknown) {
    this.candidates.push(c)
  }
  async getStats() {
    return new Map()
  }
  close() {
    this.closed = true
  }
  connect() {
    this.connectionState = 'connected'
    this.onconnectionstatechange?.()
  }
}

const track = () => ({ enabled: true, stop: vi.fn() })

function setup(role: 'customer' | 'agent' = 'customer') {
  const client = new AudioCallClient({
    signalingUrl: 'ws://test/ws-call',
    userId: 'me',
    role,
  })
  const states: CallState[] = []
  const errors: string[] = []
  client.on('state', (s) => states.push(s))
  client.on('error', (e) => errors.push(e.code))
  client.connect()
  const ws = FakeSocket.instances.at(-1)!
  ws.open()
  ws.receive({ type: 'registered', onlineAgents: 1 })
  return { client, ws, states, errors }
}

const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.instances = []
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('RTCPeerConnection', FakePeer)
  vi.stubGlobal(
    'RTCSessionDescription',
    class {
      constructor(init: object) {
        Object.assign(this, init)
      }
    },
  )
  vi.stubGlobal(
    'RTCIceCandidate',
    class {
      constructor(init: object) {
        Object.assign(this, init)
      }
    },
  )
  vi.stubGlobal(
    'MediaStream',
    class {
      addTrack() {}
      getAudioTracks() {
        return []
      }
    },
  )
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getAudioTracks: () => [track()] })) },
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('AudioCallClient', () => {
  it('registers on connect and learns the online agents', () => {
    const { ws, client } = setup()
    expect(ws.frames('register')).toEqual([
      { type: 'register', role: 'customer', userId: 'me', channelId: undefined },
    ])
    expect(client.onlineAgents).toBe(1)
  })

  it('a customer calls "agent", goes active on the answer, and hangs up to the agent id it learned', async () => {
    const { client, ws, states } = setup()
    await client.startCall()
    expect(ws.frames('call', 'offer')).toHaveLength(1)
    expect(ws.frames('call', 'offer')[0]).toMatchObject({ to: 'agent', from: 'me' })
    expect(client.state).toBe('calling')

    ws.receive({ type: 'answer', from: 'agent-7', sdp: { type: 'answer', sdp: 'x' } })
    await flush()
    expect(client.state).toBe('active')

    client.hangup()
    expect(ws.frames('hangup')[0]).toMatchObject({ to: 'agent-7', from: 'me' })
    expect(states).toEqual(['calling', 'active', 'ended'])
    await vi.advanceTimersByTimeAsync(2500)
    expect(client.state).toBe('idle')
  })

  it('gives up on an unanswered outbound call after 30 s', async () => {
    const { client, ws, errors } = setup()
    await client.startCall()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(errors).toContain('call-timeout')
    expect(ws.frames('hangup')[0]).toMatchObject({ reason: 'timeout' })
    expect(client.state).toBe('ended')
  })

  it('answers an incoming call: connecting, then active once media connects', async () => {
    const { client, ws } = setup('agent')
    const incoming = vi.fn()
    client.on('incoming', incoming)
    ws.receive({
      type: 'incoming',
      from: 'cust-1',
      callerName: 'An',
      sdp: { type: 'offer', sdp: 'o' },
    })
    expect(client.state).toBe('incoming')
    expect(incoming).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'cust-1', callerName: 'An' }),
    )

    await client.acceptCall({ type: 'offer', sdp: 'o' }, 'cust-1')
    expect(ws.frames('call', 'answer')[0]).toMatchObject({ to: 'cust-1' })
    expect(client.state).toBe('connecting')

    FakePeer.last.connect()
    expect(client.state).toBe('active')
  })

  it('rejects a second call while busy', async () => {
    const { client, ws } = setup('agent')
    await client.startCall('cust-1')
    ws.receive({ type: 'incoming', from: 'cust-2', sdp: {} })
    expect(ws.frames('hangup').at(-1)).toMatchObject({ to: 'cust-2', reason: 'busy' })
    expect(client.state).toBe('calling')
  })

  it('auto-rejects an unanswered incoming call as busy after 30 s', async () => {
    const { client, ws } = setup('agent')
    ws.receive({ type: 'incoming', from: 'cust-1', sdp: {} })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(ws.frames('hangup')[0]).toMatchObject({ to: 'cust-1', reason: 'busy' })
    expect(client.state).toBe('idle')
  })

  it('buffers ICE candidates while the socket is down and re-sends them after re-registering', async () => {
    const { client, ws } = setup()
    await client.startCall()
    ws.drop()
    FakePeer.last.onicecandidate?.({ candidate: { candidate: 'c1' } })
    expect(ws.frames('call', 'ice')).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(20_000) // reconnect backoff
    const ws2 = FakeSocket.instances.at(-1)!
    expect(ws2).not.toBe(ws)
    ws2.open()
    expect(ws2.sent.map((m) => m.type)).toEqual(['register', 'call'])
    expect(ws2.frames('call', 'ice')[0]).toMatchObject({ candidate: { candidate: 'c1' } })
  })

  it('buffers inbound candidates until the remote description is set', async () => {
    const { client, ws } = setup()
    await client.startCall()
    ws.receive({ type: 'ice', from: 'agent-7', candidate: { candidate: 'early' } })
    expect(FakePeer.last.candidates).toHaveLength(0)

    ws.receive({ type: 'answer', from: 'agent-7', sdp: { type: 'answer', sdp: 'x' } })
    await flush()
    expect(FakePeer.last.candidates).toHaveLength(1)
  })

  it('ends a zombie call when the server no longer knows the session after a reconnect', async () => {
    const { client, ws, errors } = setup()
    await client.startCall()
    ws.receive({ type: 'registered', onlineAgents: 1, activeCall: null })
    expect(client.state).toBe('ended')
    expect(errors).toContain('call-gone')
  })

  it('keeps a live call when the server still has the session', async () => {
    const { client, ws } = setup()
    await client.startCall()
    ws.receive({ type: 'registered', onlineAgents: 1, activeCall: { id: 's' } })
    expect(client.state).toBe('calling')
  })

  it('applies the server-provided ICE servers to later connections', async () => {
    const { client, ws } = setup()
    ws.receive({
      type: 'registered',
      iceServers: [{ urls: 'turn:t', username: 'u', credential: 'c' }],
    })
    const created: unknown[] = []
    vi.stubGlobal(
      'RTCPeerConnection',
      class extends FakePeer {
        constructor(cfg: unknown) {
          super()
          created.push(cfg)
        }
      },
    )
    await client.startCall()
    expect(created[0]).toMatchObject({ iceServers: [{ urls: 'turn:t' }] })
  })

  it('uses refreshed TURN credentials for calls started after the refresh', async () => {
    const { client, ws } = setup()
    ws.receive({ type: 'registered', iceServers: [{ urls: 'turn:t', credential: 'old' }] })
    ws.receive({ type: 'ice-servers', iceServers: [{ urls: 'turn:t', credential: 'new' }] })
    const created: unknown[] = []
    vi.stubGlobal(
      'RTCPeerConnection',
      class extends FakePeer {
        constructor(cfg: unknown) {
          super()
          created.push(cfg)
        }
      },
    )
    await client.startCall()
    expect(created[0]).toMatchObject({ iceServers: [{ credential: 'new' }] })
  })

  it('does not reconnect a caller refused for their region', async () => {
    const { ws, errors } = setup()
    ws.receive({
      type: 'error',
      code: 'region-blocked',
      message: 'Calls are only available in Vietnam',
    })
    ws.drop(4403, 'region-blocked')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(errors).toContain('region-blocked')
    expect(FakeSocket.instances.at(-1)).toBe(ws)
  })

  it('times out when media never connects — on every call, not only the first', async () => {
    const { client, ws, errors } = setup()
    for (let call = 1; call <= 2; call++) {
      await client.startCall()
      ws.receive({ type: 'answer', from: 'agent-7', sdp: { type: 'answer', sdp: 'x' } })
      await flush()
      if (call === 1) {
        FakePeer.last.connect() // the first call connects fine
        client.hangup()
        await vi.advanceTimersByTimeAsync(2500)
      }
    }
    await vi.advanceTimersByTimeAsync(20_000)
    expect(errors).toContain('media-timeout')
    expect(client.state).toBe('ended')
  })

  it('reports a denied microphone and does not call', async () => {
    const { client, ws, errors } = setup()
    ;(navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('denied'),
    )
    await client.startCall()
    expect(errors).toContain('mic-denied')
    expect(ws.frames('call')).toHaveLength(0)
    expect(client.state).toBe('idle')
  })

  it('stops ringing on a terminal server error', async () => {
    const { client, ws, errors } = setup()
    await client.startCall()
    ws.receive({ type: 'error', code: 'no-agent', message: 'nobody' })
    expect(client.state).toBe('idle')
    expect(errors).toContain('no-agent')
  })
})
