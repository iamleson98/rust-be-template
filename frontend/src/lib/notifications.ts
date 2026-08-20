/**
 * Browser push notifications — requests permission and shows notifications
 * for incoming chat messages and audio calls.
 *
 * Used when the app is in the background (tab not focused) or the
 * browser window is minimized. On mobile, the browser must be installed
 * as a PWA for notifications to show when the browser is closed.
 *
 * ## Permission flow
 *   1. Call `requestNotificationPermission()` on first user interaction
 *      (e.g. when they open the chat panel for the first time).
 *   2. Call `showNotification(title, body, tag)` when a message/call
 *      arrives and the page is NOT visible.
 *   3. Notifications auto-close after 10s. Clicking a notification
 *      focuses the tab.
 */

let permissionRequested = false

/** Request notification permission. Returns the current permission state. */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied'
  }

  if (Notification.permission === 'default' && !permissionRequested) {
    permissionRequested = true
    try {
      return await Notification.requestPermission()
    } catch {
      return 'denied'
    }
  }

  return Notification.permission
}

/** Check if notifications are granted. */
export function notificationsEnabled(): boolean {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false
  }
  return Notification.permission === 'granted'
}

/** Check if the page is currently NOT visible (tab in background). */
export function isPageHidden(): boolean {
  if (typeof document === 'undefined') return false
  return document.visibilityState === 'hidden' || document.hidden
}

/**
 * Show a browser notification. No-op if:
 *   - Notifications aren't supported / permitted.
 *   - The page IS visible (user is already looking at the app).
 *
 * @param title Notification title
 * @param body  Notification body text
 * @param tag   Unique tag (prevents duplicate notifications — newer replaces older with same tag)
 * @param onClick Optional callback when the notification is clicked
 */
export function showNotification(
  title: string,
  body: string,
  tag: string,
  onClick?: () => void,
): void {
  if (!notificationsEnabled()) return
  // Only show notifications when the page is hidden — if the user
  // is looking at the app, they don't need a desktop notification.
  if (!isPageHidden()) return

  try {
    const notification = new Notification(title, {
      body,
      tag,
      icon: '/logo.svg',
      badge: '/icons/icon-192.png',
      silent: false,
    })

    // Auto-close after 10 seconds.
    setTimeout(() => {
      try {
        notification.close()
      } catch {
        // noop
      }
    }, 10_000)

    if (onClick) {
      notification.onclick = () => {
        // Focus the tab.
        if (typeof window !== 'undefined') {
          window.focus()
        }
        onClick()
        try {
          notification.close()
        } catch {
          // noop
        }
      }
    }
  } catch {
    // Some browsers throw if the icon fails to load — retry without icon.
    try {
      new Notification(title, { body, tag })
    } catch {
      // Silently fail — notifications are a nice-to-have.
    }
  }
}

/**
 * Show a notification for an incoming chat message.
 * Called from the chat widget's WS message handler.
 */
export function notifyChatMessage(senderName: string, messagePreview: string): void {
  showNotification(
    `Tin nhắn từ ${senderName}`,
    messagePreview.length > 100 ? messagePreview.slice(0, 100) + '…' : messagePreview,
    'chat-message',
    () => {
      // Focus the chat widget — dispatch a custom event that the
      // chat widget listens for.
      window.dispatchEvent(new CustomEvent('vexevn:focus-chat'))
    },
  )
}

/**
 * Show a notification for an incoming audio call.
 * Called from the audio call widget's incoming handler.
 */
export function notifyIncomingCall(callerName: string): void {
  showNotification(
    'Cuộc gọi đến',
    `${callerName} đang gọi bạn — nhấn để trả lời`,
    'audio-call',
    () => {
      window.dispatchEvent(new CustomEvent('vexevn:focus-call'))
    },
  )
}
