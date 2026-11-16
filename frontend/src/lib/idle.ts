/**
 * Runs `task` when the browser has nothing better to do (after the first
 * paint and the page's own work), at the latest `timeout` ms from now.
 * Safari has no `requestIdleCallback`: a timer stands in.
 */
export function whenIdle(task: () => void, timeout = 4000): void {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(task, { timeout })
  } else {
    setTimeout(task, Math.min(timeout, 2000))
  }
}

/** Runs `task` once the page has loaded, then when idle: for work no visitor waits on. */
export function afterLoadWhenIdle(task: () => void): void {
  const start = () => whenIdle(task)
  if (document.readyState === 'complete') start()
  else window.addEventListener('load', start, { once: true })
}
