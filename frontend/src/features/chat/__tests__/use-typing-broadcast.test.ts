import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTypingBroadcast } from '../use-typing-broadcast'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function setup(channelId: string | undefined, accepts = true) {
  const send = vi.fn(() => accepts)
  const hook = renderHook(({ id }) => useTypingBroadcast(id, send), { initialProps: { id: channelId } })
  return { send, ...hook }
}

describe('useTypingBroadcast', () => {
  it('announces typing once per burst, not on every keystroke', () => {
    const { send, result } = setup('c1')
    act(() => result.current.ping())
    act(() => result.current.ping())
    act(() => result.current.ping())
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('c1', true)
  })

  it('announces "stopped" after two seconds of silence, and typing again starts a new burst', () => {
    const { send, result } = setup('c1')
    act(() => result.current.ping())
    act(() => void vi.advanceTimersByTime(1900))
    act(() => result.current.ping()) // keeps the burst alive
    act(() => void vi.advanceTimersByTime(1900))
    expect(send).toHaveBeenCalledTimes(1)

    act(() => void vi.advanceTimersByTime(200))
    expect(send).toHaveBeenLastCalledWith('c1', false)

    act(() => result.current.ping())
    expect(send).toHaveBeenLastCalledWith('c1', true)
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('stop() ends the burst immediately and cancels the idle timer', () => {
    const { send, result } = setup('c1')
    act(() => result.current.ping())
    act(() => result.current.stop())
    expect(send).toHaveBeenLastCalledWith('c1', false)
    act(() => void vi.advanceTimersByTime(5000))
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('stop() is silent when nobody was typing', () => {
    const { send, result } = setup('c1')
    act(() => result.current.stop())
    expect(send).not.toHaveBeenCalled()
  })

  it('tells the old channel "stopped" when the channel changes or the component unmounts', () => {
    const { send, result, rerender, unmount } = setup('c1')
    act(() => result.current.ping())
    rerender({ id: 'c2' })
    expect(send).toHaveBeenLastCalledWith('c1', false)

    act(() => result.current.ping())
    expect(send).toHaveBeenLastCalledWith('c2', true)
    unmount()
    expect(send).toHaveBeenLastCalledWith('c2', false)
  })

  it('does not count a frame the socket refused as a burst', () => {
    const { send, result } = setup('c1', false)
    act(() => result.current.ping())
    act(() => result.current.ping())
    expect(send).toHaveBeenCalledTimes(2) // retried on the next keystroke
    act(() => result.current.stop())
    expect(send).toHaveBeenCalledTimes(2) // nothing to stop
  })

  it('ignores keystrokes without a channel', () => {
    const { send, result } = setup(undefined)
    act(() => result.current.ping())
    expect(send).not.toHaveBeenCalled()
  })
})
