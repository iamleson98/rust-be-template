import { afterEach, describe, expect, it, vi } from 'vitest'
import { afterLoadWhenIdle, whenIdle } from '@/lib/idle'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('whenIdle', () => {
  it('runs the task in an idle period, at the latest after the timeout', () => {
    const request = vi.fn((task: () => void) => task())
    vi.stubGlobal('requestIdleCallback', request)
    const task = vi.fn()
    whenIdle(task, 1500)
    expect(request).toHaveBeenCalledWith(task, { timeout: 1500 })
    expect(task).toHaveBeenCalledOnce()
  })

  it('uses a timer where there is no idle callback (Safari)', () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestIdleCallback', undefined)
    const task = vi.fn()
    whenIdle(task, 4000)
    expect(task).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2000)
    expect(task).toHaveBeenCalledOnce()
  })
})

describe('afterLoadWhenIdle', () => {
  it('waits for the load event while the page is still loading', () => {
    vi.stubGlobal('requestIdleCallback', (task: () => void) => task())
    const state = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
    const task = vi.fn()
    afterLoadWhenIdle(task)
    expect(task).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('load'))
    expect(task).toHaveBeenCalledOnce()
    state.mockRestore()
  })

  it('goes straight to idle once the page has loaded', () => {
    vi.stubGlobal('requestIdleCallback', (task: () => void) => task())
    const state = vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete')
    const task = vi.fn()
    afterLoadWhenIdle(task)
    expect(task).toHaveBeenCalledOnce()
    state.mockRestore()
  })
})
