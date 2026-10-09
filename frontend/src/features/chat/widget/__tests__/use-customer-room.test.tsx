import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatEvent } from '../../events'
import { useCustomerRoom } from '../use-customer-room'

const mocks = vi.hoisted(() => ({
  onEvent: null as null | ((event: unknown) => void),
  onGiveUp: null as null | (() => void),
  toast: { error: vi.fn(), warning: vi.fn() },
  notifyChatMessage: vi.fn(),
  playSound: vi.fn(),
  startTitleNotification: vi.fn(),
}))

vi.mock('../../use-chat-socket', () => ({
  useChatSocket: (options: { onEvent: (event: unknown) => void; onGiveUp: () => void }) => {
    mocks.onEvent = options.onEvent
    mocks.onGiveUp = options.onGiveUp
    return { connected: true, send: vi.fn(() => true) }
  },
}))
vi.mock('sonner', () => ({ toast: mocks.toast }))
vi.mock('@/lib/notifications', () => ({ notifyChatMessage: mocks.notifyChatMessage }))
vi.mock('@/lib/sound-effects', () => ({ playSound: mocks.playSound }))
vi.mock('@/lib/title-notifier', () => ({ startTitleNotification: mocks.startTitleNotification }))

const queryClient = new QueryClient()
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
)

const fire = (event: ChatEvent) => act(() => mocks.onEvent?.(event))

function setup(initial: { channelId?: string } = { channelId: 'c1' }) {
  const onBanned = vi.fn()
  const hook = renderHook(
    (p: { channelId?: string }) =>
      useCustomerRoom({ userId: 'me', channelId: p.channelId, onBanned }),
    { initialProps: initial, wrapper },
  )
  return { onBanned, ...hook }
}

beforeEach(() => {
  vi.clearAllMocks()
  queryClient.clear()
})

describe('useCustomerRoom', () => {
  it('shows the other side typing in the open channel only', () => {
    const { result } = setup()
    fire({ type: 'typing', channelId: 'other', name: 'An', isTyping: true })
    expect(result.current.peerTyping).toBe(false)

    fire({ type: 'typing', channelId: 'c1', name: 'An', isTyping: true })
    expect(result.current.peerTyping).toBe(true)
    fire({ type: 'typing', channelId: 'c1', name: 'An', isTyping: false })
    expect(result.current.peerTyping).toBe(false)
  })

  it("ignores typing frames echoed from the customer's own other tabs", () => {
    const { result } = setup()
    fire({ type: 'typing', channelId: 'c1', userId: 'me', name: 'Me', isTyping: true })
    expect(result.current.peerTyping).toBe(false)
  })

  it('tracks who handles the conversation and whether the assistant covers it', () => {
    const { result } = setup()
    fire({ type: 'joined', channelId: 'c1', botActive: true })
    expect(result.current.botActive).toBe(true)

    fire({ type: 'channel_assigned', channelId: 'c1', employeeId: 'e1', employeeName: 'Lan' })
    expect(result.current.assignee).toBe('Lan')
    expect(result.current.botActive).toBe(false) // a human took over

    fire({ type: 'channel_released', channelId: 'c1' })
    expect(result.current.assignee).toBeNull()

    fire({ type: 'staff_presence', botActive: true })
    expect(result.current.botActive).toBe(true)
  })

  it('forgets channel state when the channel changes', () => {
    const { result, rerender } = setup()
    fire({ type: 'channel_assigned', channelId: 'c1', employeeId: 'e1', employeeName: 'Lan' })
    fire({ type: 'typing', channelId: 'c1', name: 'Lan', isTyping: true })
    rerender({ channelId: 'c2' })
    expect(result.current.assignee).toBeNull()
    expect(result.current.peerTyping).toBe(false)
  })

  it('notifies and sounds for a support message, and refreshes the chat queries', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    setup()
    fire({
      type: 'message',
      channelId: 'c1',
      senderType: 'employee',
      senderName: 'Lan',
      text: 'Xin chào',
    })
    expect(mocks.notifyChatMessage).toHaveBeenCalledWith('Lan', 'Xin chào')
    expect(mocks.startTitleNotification).toHaveBeenCalled()
    expect(mocks.playSound).toHaveBeenCalledWith('message')
    expect(invalidate).toHaveBeenCalled()
  })

  it("only sounds for the customer's own message in the open channel", () => {
    setup()
    fire({ type: 'message', channelId: 'c1', senderType: 'user', text: 'hi' })
    expect(mocks.playSound).toHaveBeenCalledTimes(1)
    expect(mocks.notifyChatMessage).not.toHaveBeenCalled()

    fire({ type: 'message', channelId: 'other', senderType: 'user', text: 'hi' })
    expect(mocks.playSound).toHaveBeenCalledTimes(1)
  })

  it('surfaces server errors and abuse warnings, and clears the draft on a ban', () => {
    const { onBanned } = setup()
    fire({ type: 'error', message: 'boom' })
    expect(mocks.toast.error).toHaveBeenCalledWith('boom')

    fire({ type: 'abuse:warned', reason: 'spam' })
    expect(mocks.toast.warning).toHaveBeenCalled()

    fire({ type: 'abuse:banned', reason: 'too much spam' })
    expect(mocks.toast.error).toHaveBeenLastCalledWith('too much spam', { duration: 12000 })
    expect(onBanned).toHaveBeenCalled()
  })

  it('re-checks the session when the socket cannot connect at all', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    setup()
    act(() => mocks.onGiveUp?.())
    expect(invalidate).toHaveBeenCalled()
  })
})
