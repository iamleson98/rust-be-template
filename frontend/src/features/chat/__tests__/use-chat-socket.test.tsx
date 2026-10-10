import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatEvent } from '../events'
import { useChatSocket } from '../use-chat-socket'

const mocks = vi.hoisted(() => ({ sockets: [] as unknown[] }))

vi.mock('@/api/ws-client', () => ({
  WsClient: class {
    connected = false
    handlers = new Map<string, Set<(data: Record<string, unknown>) => void>>()
    sent: [string, Record<string, unknown> | undefined][] = []
    close = vi.fn()
    constructor() {
      mocks.sockets.push(this)
    }
    on(type: string, handler: (data: Record<string, unknown>) => void) {
      if (!this.handlers.has(type)) this.handlers.set(type, new Set())
      this.handlers.get(type)!.add(handler)
      return this
    }
    off(type: string, handler: (data: Record<string, unknown>) => void) {
      this.handlers.get(type)?.delete(handler)
      return this
    }
    send(type: string, data?: Record<string, unknown>) {
      if (!this.connected) return false
      this.sent.push([type, data])
      return true
    }
    // test controls
    emit(type: string, data: Record<string, unknown> = {}) {
      for (const handler of this.handlers.get(type) ?? []) handler(data)
    }
    open() {
      this.connected = true
      this.emit('_open')
    }
    drop() {
      this.connected = false
      this.emit('_close')
    }
  },
}))

type FakeSocket = {
  connected: boolean
  sent: [string, Record<string, unknown> | undefined][]
  close: ReturnType<typeof vi.fn>
  emit(type: string, data?: Record<string, unknown>): void
  open(): void
  drop(): void
}
const socket = () => mocks.sockets.at(-1) as FakeSocket
const joins = () =>
  socket()
    .sent.filter(([type]) => type === 'join')
    .map(([, data]) => data?.channelId)

beforeEach(() => {
  mocks.sockets.length = 0
})

type Props = { enabled: boolean; channelId?: string | null; userId?: string | null }

function setup(props: Partial<Props> = {}) {
  const onEvent = vi.fn<(event: ChatEvent) => void>()
  const onGiveUp = vi.fn()
  const hook = renderHook((p: Props) => useChatSocket({ ...p, onEvent, onGiveUp }), {
    initialProps: { enabled: true, ...props },
  })
  return { onEvent, onGiveUp, ...hook }
}

describe('useChatSocket', () => {
  it('stays closed until enabled', () => {
    setup({ enabled: false })
    expect(mocks.sockets).toHaveLength(0)
  })

  it('reports the connection state and refuses to send while closed', () => {
    const { result } = setup()
    expect(result.current.connected).toBe(false)
    expect(result.current.send('typing', { channelId: 'c1' })).toBe(false)

    act(() => socket().open())
    expect(result.current.connected).toBe(true)
    expect(result.current.send('typing', { channelId: 'c1' })).toBe(true)

    act(() => socket().drop())
    expect(result.current.connected).toBe(false)
  })

  it('joins the channel room when the socket opens, and again after every reconnect', () => {
    setup({ channelId: 'c1' })
    act(() => socket().open())
    expect(joins()).toEqual(['c1'])

    act(() => socket().drop())
    act(() => socket().open())
    expect(joins()).toEqual(['c1', 'c1'])
  })

  it('joins the new room when the channel changes while connected', () => {
    const { rerender } = setup({ channelId: 'c1' })
    act(() => socket().open())
    rerender({ enabled: true, channelId: 'c2' })
    expect(joins()).toEqual(['c1', 'c2'])
  })

  it('does not join without a channel', () => {
    setup({ channelId: null })
    act(() => socket().open())
    expect(joins()).toEqual([])
  })

  it('forwards every server frame to onEvent', () => {
    const { onEvent } = setup()
    act(() =>
      socket().emit('_message', { type: 'typing', channelId: 'c1', name: 'An', isTyping: true }),
    )
    expect(onEvent).toHaveBeenCalledWith({
      type: 'typing',
      channelId: 'c1',
      name: 'An',
      isTyping: true,
    })
  })

  it('gives up only when the socket never opened', () => {
    const { onGiveUp } = setup()
    act(() => socket().emit('_giveup', { everOpened: true }))
    expect(onGiveUp).not.toHaveBeenCalled()
    act(() => socket().emit('_giveup', { everOpened: false }))
    expect(onGiveUp).toHaveBeenCalledTimes(1)
  })

  it('shares one socket between holders and closes it when the last lets go', () => {
    const presence = setup()
    const panel = setup({ channelId: 'c1' })
    expect(mocks.sockets).toHaveLength(1)
    act(() => socket().open())
    expect(presence.result.current.connected).toBe(true)
    expect(panel.result.current.connected).toBe(true)
    expect(joins()).toEqual(['c1'])

    panel.unmount()
    expect(socket().sent.at(-1)).toEqual(['leave', undefined]) // support sees the panel close
    expect(socket().close).not.toHaveBeenCalled()
    act(() => socket().emit('_message', { type: 'typing' }))
    expect(panel.onEvent).not.toHaveBeenCalled()
    expect(presence.onEvent).toHaveBeenCalledTimes(1)

    presence.unmount()
    expect(socket().close).toHaveBeenCalled()
  })

  it('a holder that joins an open socket is connected at once', () => {
    setup()
    act(() => socket().open())
    const late = setup({ channelId: 'c9' })
    expect(late.result.current.connected).toBe(true)
    expect(joins()).toEqual(['c9'])
  })

  it('reopens the socket when the signed-in user changes', () => {
    const { rerender } = setup({ userId: 'a' })
    const first = socket()
    rerender({ enabled: true, userId: 'b' })
    expect(first.close).toHaveBeenCalled()
    expect(socket()).not.toBe(first)
  })

  it('closes the socket when disabled or unmounted', () => {
    const { rerender, unmount } = setup()
    const first = socket()
    rerender({ enabled: false })
    expect(first.close).toHaveBeenCalled()

    rerender({ enabled: true })
    const second = socket()
    expect(second).not.toBe(first)
    unmount()
    expect(second.close).toHaveBeenCalled()
  })
})
