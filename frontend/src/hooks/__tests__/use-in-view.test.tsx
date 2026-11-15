import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useInView } from '../use-in-view'

function Probe() {
  const [ref, seen] = useInView()
  return <div ref={ref}>{seen ? 'seen' : 'unseen'}</div>
}

/** An IntersectionObserver the test can fire by hand. */
function stubObserver() {
  const observers: {
    callback: IntersectionObserverCallback
    options?: IntersectionObserverInit
    observe: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
  }[] = []
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        observers.push({ callback, options, observe: this.observe, disconnect: this.disconnect })
      }
    },
  )
  const fire = (isIntersecting: boolean) =>
    act(() =>
      observers[0].callback(
        [{ isIntersecting } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    )
  return { observers, fire }
}

afterEach(() => vi.unstubAllGlobals())

describe('useInView', () => {
  it('waits for the element to come near the viewport, and stays seen after', () => {
    const { observers, fire } = stubObserver()
    render(<Probe />)
    expect(screen.getByText('unseen')).toBeVisible()
    expect(observers[0].options).toEqual({ rootMargin: '300px' })
    expect(observers[0].observe).toHaveBeenCalledTimes(1)

    fire(false)
    expect(screen.getByText('unseen')).toBeVisible()
    fire(true)
    expect(screen.getByText('seen')).toBeVisible()
    // Seen for good: the observer is let go.
    expect(observers[0].disconnect).toHaveBeenCalled()
  })

  it('lets go of the observer when the element goes away unseen', () => {
    const { observers } = stubObserver()
    const { unmount } = render(<Probe />)
    unmount()
    expect(observers[0].disconnect).toHaveBeenCalled()
  })

  it('is seen at once where there is no IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    render(<Probe />)
    expect(screen.getByText('seen')).toBeVisible()
  })
})
