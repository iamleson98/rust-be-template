import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatEvent } from '@/features/chat/events'
import { useSession } from '@/stores/session'
import { useAdminChatSocket } from '../use-admin-chat-socket'

const mocks = vi.hoisted(() => ({
  onEvent: null as null | ((event: unknown) => void),
  enabled: null as null | boolean,
  send: vi.fn(() => true),
  markRead: vi.fn(),
  playSound: vi.fn(),
  startTitleNotification: vi.fn(),
  stopTitleNotification: vi.fn(),
}))

vi.mock('@/features/chat/use-chat-socket', () => ({
  useChatSocket: (options: { enabled: boolean; onEvent: (event: unknown) => void }) => {
    mocks.onEvent = options.onEvent
    mocks.enabled = options.enabled
    return { connected: true, send: mocks.send }
  },
}))
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  chatMarkReadMutation: () => ({ mutationFn: async (vars: unknown) => mocks.markRead(vars) }),
}))
vi.mock('@/lib/sound-effects', () => ({ playSound: mocks.playSound }))
vi.mock('@/lib/title-notifier', () => ({
  startTitleNotification: mocks.startTitleNotification,
  stopTitleNotification: mocks.stopTitleNotification,
}))

const queryClient = new QueryClient()
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
)
const staff = { id: 'staff-1', type: 'admin', role: 'admin', name: 'S' } as never

const fire = (event: ChatEvent) => act(() => mocks.onEvent?.(event))
const setup = (channelId?: string) =>
  renderHook((p: { id?: string }) => useAdminChatSocket(p.id), { initialProps: { id: channelId }, wrapper })

beforeEach(() => {
  vi.clearAllMocks()
  queryClient.clear()
  useSession.getState().setUser(staff)
})
afterEach(() => useSession.getState().setUser(null))

describe('useAdminChatSocket', () => {
  it('connects for staff only', () => {
    setup()
    expect(mocks.enabled).toBe(true)

    useSession.getState().setUser({ id: 'u', type: 'user', role: 'user', name: 'C' } as never)
    setup()
    expect(mocks.enabled).toBe(false)
  })

  it('flags a channel that got a customer message while closed, and clears it on opening', () => {
    const { result, rerender } = setup('open')
    fire({ type: 'channel_message', channelId: 'other' })
    expect([...result.current.unseen]).toEqual(['other'])
    expect(mocks.playSound).toHaveBeenCalledWith('message')
    expect(mocks.startTitleNotification).toHaveBeenCalled()

    fire({ type: 'channel_message', channelId: 'open' })
    expect([...result.current.unseen]).toEqual(['other']) // the open one needs no flag

    rerender({ id: 'other' })
    expect(result.current.unseen.size).toBe(0)
    expect(mocks.stopTitleNotification).toHaveBeenCalled()
  })

  it('marks the open channel read when the customer writes in it', async () => {
    setup('open')
    fire({ type: 'message', channelId: 'open', senderType: 'user' })
    await vi.waitFor(() => expect(mocks.markRead).toHaveBeenCalledWith({ path: { id: 'open' } }))

    mocks.markRead.mockClear()
    fire({ type: 'message', channelId: 'open', senderType: 'employee' })
    fire({ type: 'message', channelId: 'other', senderType: 'user' })
    await act(async () => {})
    expect(mocks.markRead).not.toHaveBeenCalled()
  })

  it('shows the customer typing and online state of the open channel, and resets on switching', () => {
    const { result, rerender } = setup('open')
    fire({ type: 'typing', channelId: 'open', name: 'An', isTyping: true })
    fire({ type: 'presence', channelId: 'open', online: true })
    expect(result.current.typingUser).toEqual({ name: 'An' })
    expect(result.current.userOnline).toBe(true)

    fire({ type: 'typing', channelId: 'open', userId: 'staff-1', name: 'Me', isTyping: false })
    expect(result.current.typingUser).toEqual({ name: 'An' }) // own echo ignored

    rerender({ id: 'next' })
    expect(result.current.typingUser).toBeNull()
    expect(result.current.userOnline).toBe(false)
  })

  it('keeps the latest staff presence snapshot, defaulting what the hub omits', () => {
    const { result } = setup()
    expect(result.current.staffPresence).toBeNull()
    fire({ type: 'staff_presence', botActive: true }) // customers-style frame, no staff list: ignored
    expect(result.current.staffPresence).toBeNull()

    const staffEntry = { userId: 'e1', name: 'Lan', role: 'employee', online: true, busy: false, activeChats: 2 }
    fire({ type: 'staff_presence', staff: [staffEntry], botActive: false })
    expect(result.current.staffPresence).toEqual({ staff: [staffEntry], offline: [], botActive: false })
  })

  it('sends typing frames over the socket', () => {
    const { result } = setup()
    result.current.sendTyping('open', true)
    expect(mocks.send).toHaveBeenCalledWith('typing', { channelId: 'open', isTyping: true })
  })
})
