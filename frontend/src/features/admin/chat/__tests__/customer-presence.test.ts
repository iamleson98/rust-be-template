import { describe, expect, it } from 'vitest'
import type { ChatChannelOut } from '@/api'
import {
  onlineFirst,
  onlineUsers,
  withPresenceEvent,
  type PresenceEvents,
} from '../customer-presence'

const ev = (userId: string, online: boolean, seq: number) => ({ userId, online, seq })

describe('onlineUsers', () => {
  it('applies only the events newer than the snapshot', () => {
    let events: PresenceEvents = new Map()
    events = withPresenceEvent(events, ev('a', false, 4))
    events = withPresenceEvent(events, ev('b', true, 6))
    expect([...onlineUsers({ seq: 5, userIds: ['a'] }, events)].sort()).toEqual(['a', 'b'])
  })

  it('uses the events alone until the snapshot arrives', () => {
    const events = withPresenceEvent(new Map(), ev('a', true, 1))
    expect([...onlineUsers(undefined, events)]).toEqual(['a'])
  })
})

describe('withPresenceEvent', () => {
  it('keeps the newest event per customer, whatever order they arrive in', () => {
    let events: PresenceEvents = new Map()
    events = withPresenceEvent(events, ev('a', true, 3)) // reopened tab…
    const before = events
    events = withPresenceEvent(events, ev('a', false, 2)) // …its close arrives late
    expect(events).toBe(before)
    expect(events.get('a')).toEqual({ online: true, seq: 3 })
  })

  it('drops what the snapshot already covers', () => {
    let events: PresenceEvents = new Map()
    events = withPresenceEvent(events, ev('a', true, 2))
    events = withPresenceEvent(events, ev('b', true, 7), 5)
    expect([...events.keys()]).toEqual(['b'])
    expect(withPresenceEvent(events, ev('c', true, 5), 5)).toBe(events)
  })
})

describe('onlineFirst', () => {
  const ch = (id: string, userId: string, at: string) =>
    ({ id, userId, lastMessageAt: at }) as ChatChannelOut

  it('lists online customers first, each group newest first, every channel once', () => {
    const pages = [
      ch('1', 'u1', '2026-10-10T09:00:00Z'),
      ch('2', 'u2', '2026-10-10T08:00:00Z'),
      ch('3', 'u3', '2026-10-10T07:00:00Z'),
    ]
    const onlineOnly = [
      ch('9', 'u9', '2026-10-01T00:00:00Z'),
      ch('3', 'u3', '2026-10-10T07:30:00Z'),
    ]
    const { channels, onlineCount } = onlineFirst(pages, onlineOnly, new Set(['u3', 'u9']))
    expect(channels.map((c) => c.id)).toEqual(['3', '9', '1', '2'])
    expect(onlineCount).toBe(2)
    expect(channels[0].lastMessageAt).toBe('2026-10-10T07:30:00Z') // the fresher copy
  })

  it('keeps a channel that went offline, among the rest', () => {
    const onlineOnly = [ch('9', 'u9', '2026-10-01T00:00:00Z')]
    const { channels, onlineCount } = onlineFirst([], onlineOnly, new Set())
    expect(channels.map((c) => c.id)).toEqual(['9'])
    expect(onlineCount).toBe(0)
  })
})
