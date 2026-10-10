/**
 * The widget hook against a fake client: when it connects, the customer's
 * one-click call, the toasts when nobody can answer, folding the panel after
 * the call, and the staff incoming-call flow.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '@/stores/session'
import { useUi } from '@/stores/ui'
import { Emitter } from '../emitter'
import { useAudioCall } from '../use-audio-call'

const mocks = vi.hoisted(() => ({
  clients: [] as unknown[],
  toastInfo: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { info: mocks.toastInfo, error: mocks.toastError } }))
vi.mock('@/lib/sound-effects', () => ({ playSound: vi.fn(), startRingTone: vi.fn(() => vi.fn()) }))
vi.mock('@/lib/notifications', () => ({
  ensureCallNotificationPermission: vi.fn(async () => 'default'),
  notifyIncomingCall: vi.fn(),
}))
vi.mock('../audio-call-client', () => ({
  AudioCallClient: class extends Emitter<Record<string, never>> {
    remoteAudioElement = null
    connect = vi.fn()
    dispose = vi.fn()
    startCall = vi.fn(async () => {})
    acceptCall = vi.fn(async () => {})
    rejectCall = vi.fn()
    hangup = vi.fn()
    toggleMic = vi.fn(() => false)
    constructor(public cfg: unknown) {
      super()
      mocks.clients.push(this)
    }
    // the hook subscribes with client.on(...); drive events through the emitter
    fire(event: string, data?: unknown) {
      ;(this as unknown as Emitter<Record<string, unknown>>).emit(event, data)
    }
  },
}))

type FakeClient = {
  cfg: { role: string; userId: string }
  connect: ReturnType<typeof vi.fn>
  startCall: ReturnType<typeof vi.fn>
  acceptCall: ReturnType<typeof vi.fn>
  rejectCall: ReturnType<typeof vi.fn>
  hangup: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  fire(event: string, data?: unknown): void
}
const lastClient = () => mocks.clients.at(-1) as FakeClient

const user = (role: 'user' | 'admin', id = 'u1') =>
  ({ id, type: role, role, name: 'N', email: null, phone: null, avatarUrl: null }) as never

beforeEach(() => {
  mocks.clients.length = 0
  mocks.toastInfo.mockClear()
  mocks.toastError.mockClear()
  useUi.setState({ callOpen: false })
})
afterEach(() => useSession.getState().setUser(null))

async function until(fn: () => unknown) {
  await waitFor(() => expect(fn()).toBeTruthy())
}

describe('useAudioCall — customer', () => {
  beforeEach(() => useSession.getState().setUser(user('user')))

  it('does not connect until the panel opens, then connects as a customer', async () => {
    renderHook(() => useAudioCall())
    await act(async () => {})
    expect(mocks.clients).toHaveLength(0)

    act(() => useUi.getState().setCallOpen(true))
    await until(() => mocks.clients.length === 1)
    expect(lastClient().cfg).toMatchObject({ role: 'customer', userId: 'u1' })
    expect(lastClient().connect).toHaveBeenCalled()
  })

  it('starts the call by itself once an agent is available', async () => {
    renderHook(() => useAudioCall())
    act(() => useUi.getState().setCallOpen(true))
    await until(() => mocks.clients.length === 1)

    act(() => lastClient().fire('presence', { onlineAgents: 2, agentsAvailable: true }))
    await until(() => lastClient().startCall.mock.calls.length === 1)
  })

  it('tells the customer and closes when no agent is online, or all are busy', async () => {
    renderHook(() => useAudioCall())
    act(() => useUi.getState().setCallOpen(true))
    await until(() => mocks.clients.length === 1)

    act(() => lastClient().fire('presence', { onlineAgents: 0 }))
    await until(() => mocks.toastInfo.mock.calls.length === 1)
    expect(useUi.getState().callOpen).toBe(false)
    expect(lastClient().startCall).not.toHaveBeenCalled()

    act(() => useUi.getState().setCallOpen(true))
    act(() => lastClient().fire('presence', { onlineAgents: 1, agentsAvailable: false }))
    await until(() => mocks.toastInfo.mock.calls.length === 2)
    expect(useUi.getState().callOpen).toBe(false)
  })

  it('hangs up when the panel is closed mid-call, and folds away after the call ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result } = renderHook(() => useAudioCall())
    act(() => useUi.getState().setCallOpen(true))
    await until(() => mocks.clients.length === 1)
    act(() => lastClient().fire('presence', { onlineAgents: 1, agentsAvailable: true }))
    await until(() => lastClient().startCall.mock.calls.length === 1)

    act(() => lastClient().fire('state', 'active'))
    expect(result.current.call.state).toBe('active')
    act(() => useUi.getState().setCallOpen(false))
    expect(lastClient().hangup).toHaveBeenCalled()

    act(() => useUi.getState().setCallOpen(true))
    act(() => lastClient().fire('state', 'ended'))
    act(() => lastClient().fire('hangup', { reason: 'declined' }))
    expect(result.current.call.endReason).toBe('declined')
    expect(useUi.getState().callOpen).toBe(true) // long enough to read why
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600)
    })
    expect(useUi.getState().callOpen).toBe(false)
    vi.useRealTimers()
  })

  it('keeps a mic-permission error until retried; other errors disappear', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result } = renderHook(() => useAudioCall())
    act(() => useUi.getState().setCallOpen(true))
    await until(() => mocks.clients.length === 1)

    act(() => lastClient().fire('error', { code: 'mic-denied', message: 'no mic' }))
    expect(result.current.call.error).toEqual({ message: 'no mic', micDenied: true })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(result.current.call.error?.micDenied).toBe(true)

    act(() => lastClient().fire('error', { code: 'call-timeout', message: 'timeout' }))
    expect(result.current.call.error).toEqual({ message: 'timeout', micDenied: false })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })
    expect(result.current.call.error).toBeNull()
    vi.useRealTimers()
  })
})

describe('useAudioCall — staff', () => {
  beforeEach(() => useSession.getState().setUser(user('admin')))

  it('connects as an agent right away, without opening the panel', async () => {
    renderHook(() => useAudioCall())
    await until(() => mocks.clients.length === 1)
    expect(lastClient().cfg).toMatchObject({ role: 'agent' })
  })

  it('shows an incoming call and accepts it with the caller offer', async () => {
    const { result } = renderHook(() => useAudioCall())
    await until(() => mocks.clients.length === 1)

    const offer = { type: 'offer', sdp: 'o' }
    act(() => lastClient().fire('incoming', { from: 'c1', callerName: 'An', sdp: offer }))
    expect(result.current.call.incoming).toMatchObject({ from: 'c1', callerName: 'An' })

    await act(async () => {
      await result.current.call.acceptCall()
    })
    expect(lastClient().acceptCall).toHaveBeenCalledWith(offer, 'c1')
    expect(result.current.call.incoming).toBeNull()
  })

  it('rejects an incoming call', async () => {
    const { result } = renderHook(() => useAudioCall())
    await until(() => mocks.clients.length === 1)
    act(() => lastClient().fire('incoming', { from: 'c1', sdp: {} }))
    await act(async () => {
      await result.current.call.rejectCall()
    })
    expect(lastClient().rejectCall).toHaveBeenCalledWith('c1')
  })

  it('drops the client when the signed-in identity changes', async () => {
    const { rerender } = renderHook(() => useAudioCall())
    await until(() => mocks.clients.length === 1)
    const first = lastClient()
    act(() => useSession.getState().setUser(user('admin', 'u2')))
    rerender()
    await until(() => mocks.clients.length === 2)
    expect(first.dispose).toHaveBeenCalled()
    expect(lastClient().cfg.userId).toBe('u2')
  })
})
