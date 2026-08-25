/**
 * Page title notification — flashes the document title when a new
 * chat message arrives while the page is hidden (tab not focused).
 *
 * ## Behavior
 *
 *   1. Call `startTitleNotification(2)` when a new message arrives.
 *      This stores the current document title + starts an interval
 *      that flips between the original title and `(N) 💬 Tin nhắn mới`
 *      every 1s. The `N` is the running unread count (incremented on
 *      each call to `startTitleNotification` while active).
 *
 *   2. The interval auto-stops when:
 *        - The user focuses the tab (`visibilitychange` + `focus`
 *          events).
 *        - `stopTitleNotification()` is called explicitly (e.g. when
 *          the user opens the chat widget).
 *
 *   3. The original title is restored on stop.
 *
 * ## Why both visibilitychange AND focus
 *
 * `visibilitychange` fires when the user switches tabs (page becomes
 * hidden). `focus` fires when the user comes back to the tab via
 * any means (alt-tab, clicking the tab, etc.). Listening to both
 * ensures we stop the flash under all return-to-tab scenarios.
 *
 * ## Why a singleton
 *
 * Only one title-flash session can be active at a time. Calling
 * `startTitleNotification` again while active just increments the
 * unread count (so 3 messages arriving in quick succession shows
 * "(3) 💬 Tin nhắn mới" rather than starting 3 separate flashers).
 */

let flashInterval: ReturnType<typeof setInterval> | null = null
let originalTitle: string | null = null
let unreadCount = 0
let toggle = false

/**
 * Start (or bump the count of) the title-flash notification.
 *
 * Safe to call multiple times — if a flash is already active, the
 * unread count is incremented + the existing interval keeps running.
 * If no flash is active, a new interval is started.
 *
 * No-op when the document is already visible (no point flashing
 * the title of a tab the user is looking at).
 */
export function startTitleNotification(count = 1): void {
  if (typeof document === 'undefined') return

  // Don't start if the page is visible — the in-app indicator + sound
  // are enough; flashing the title would be noise.
  if (document.visibilityState === 'visible') return

  // First call — store the original title so we can restore it later.
  if (originalTitle === null) {
    originalTitle = document.title
  }

  unreadCount += count

  // Already flashing — just bump the count + return. The existing
  // interval will pick up the new `unreadCount` on its next tick.
  if (flashInterval !== null) return

  // Start the flasher. The interval flips `toggle` every 1s + updates
  // the document title. When `toggle` is true, show the "(N) 💬"
  // version; when false, show the original. This creates the blinking
  // effect that grabs attention.
  flashInterval = setInterval(() => {
    toggle = !toggle
    if (toggle) {
      document.title = `(${unreadCount}) 💬 Tin nhắn mới`
    } else if (originalTitle !== null) {
      document.title = originalTitle
    }
  }, 1000)

  // Stop on focus / visibility change.
  const stop = () => {
    if (document.visibilityState === 'visible') {
      stopTitleNotification()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onFocus)
    }
  }
  const onVisibilityChange = () => stop()
  const onFocus = () => stop()
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('focus', onFocus)
}

/**
 * Stop the title-flash notification + restore the original title.
 *
 * Call this when the user opens the chat widget (so the unread
 * count resets + the title stops flashing). Idempotent — safe to
 * call when no flash is active.
 */
export function stopTitleNotification(): void {
  if (flashInterval !== null) {
    clearInterval(flashInterval)
    flashInterval = null
  }
  if (originalTitle !== null && typeof document !== 'undefined') {
    document.title = originalTitle
  }
  originalTitle = null
  unreadCount = 0
  toggle = false
}
