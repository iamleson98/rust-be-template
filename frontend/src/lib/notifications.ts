/**
 * Browser push notifications — UX-friendly permission flow.
 *
 * ## UX principle
 *
 * The native `Notification.requestPermission()` prompt is jarring when
 * it appears out of nowhere. We avoid it by:
 *
 *   1. NEVER auto-requesting permission on page load or chat open.
 *      The browser only shows the prompt once per origin — if the
 *      user dismisses it, future requests silently return "denied".
 *
 *   2. Asking ONLY when the user first uses the call feature
 *      (clicks "Gọi ngay" or opens the audio-call widget). At that
 *      point the user has clear context for why we want notifications
 *      ("so we can ring you when support calls back").
 *
 *   3. Caching the result + the user's intent in localStorage so we
 *      never ask twice. The browser remembers the actual permission;
 *      localStorage remembers our intent ("we've already asked") so
 *      we don't keep calling `requestPermission()` and getting the
 *      silent "denied" reply on every page load.
 *
 * ## What's stored
 *
 *   `datxevui:notif-permission` → "asked" | "granted" | "denied" | "unsupported"
 *   `datxevui:notif-asked-at`   → ISO timestamp (for debugging)
 *
 * If the user clears localStorage (or uses a different device), we'll
 * ask again — which is fine because the browser's own permission
 * record is per-device.
 *
 * ## Usage
 *
 * ```ts
 * import { ensureCallNotificationPermission, showNotification } from '@/lib/notifications'
 *
 * // When the user opens the audio-call widget (first call-feature use):
 * await ensureCallNotificationPermission()
 *
 * // Later, when a message arrives and the page is hidden:
 * showNotification('Tin nhắn mới', body)
 * ```
 */

const LS_PERMISSION_KEY = 'datxevui:notif-permission'
const LS_ASKED_AT_KEY = 'datxevui:notif-asked-at'

type CachedPermission = 'asked' | 'granted' | 'denied' | 'unsupported' | 'default'

function readCached(): CachedPermission {
  if (typeof window === 'undefined') return 'unsupported'
  try {
    const v = window.localStorage.getItem(LS_PERMISSION_KEY)
    if (v === 'asked' || v === 'granted' || v === 'denied' || v === 'unsupported') return v
    return 'default'
  } catch {
    // localStorage may be unavailable (private mode / disabled).
    return 'default'
  }
}

function writeCached(value: CachedPermission): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LS_PERMISSION_KEY, value)
    window.localStorage.setItem(LS_ASKED_AT_KEY, new Date().toISOString())
  } catch {
    /* ignore — best-effort cache */
  }
}

/**
 * True if the browser supports the Notifications API at all.
 * Safari on iOS < 16.4 doesn't — we silently skip the prompt there.
 */
function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

/**
 * The browser's actual current permission (independent of our cache).
 * Returns "default" / "granted" / "denied", or "unsupported" if the
 * Notifications API isn't available.
 */
export function currentPermission(): CachedPermission {
  if (!notificationsSupported()) return 'unsupported'
  // Notification.permission is one of: "default" | "granted" | "denied"
  return Notification.permission as CachedPermission
}

/**
 * Has the user already been asked for notification permission in this
 * browser? (Checked via localStorage — survives page reloads + tab
 * closures, but not "clear browsing data".)
 *
 * Use this to gate the "🔔 Bật thông báo" button — only show it if we
 * haven't asked yet, or if the user previously denied and might want
 * to re-enable.
 */
export function hasAskedBefore(): boolean {
  const cached = readCached()
  return cached === 'asked' || cached === 'granted' || cached === 'denied'
}

/**
 * Ensure notification permission has been requested. Call this when the
 * user first engages with the call feature (clicks "Gọi ngay" or
 * opens the audio-call widget). Idempotent — if we've already asked,
 * this is a no-op.
 *
 * Returns the actual permission state after the call:
 *   - "granted" — the user clicked "Allow". `showNotification()` will work.
 *   - "denied"  — the user clicked "Block". We won't ask again (the
 *                 browser silently denies future requests anyway).
 *   - "default" — the user dismissed the prompt without choosing. We
 *                 can ask again on the next call-feature interaction.
 *   - "unsupported" — the browser doesn't support notifications. Silent no-op.
 *
 * ## Why ask on call-feature use specifically?
 *
 * The customer has the clearest motivation to enable notifications
 * here: "if I close this tab, how will I know when the support agent
 * calls me back?" Asking at any other point lacks that context.
 */
export async function ensureCallNotificationPermission(): Promise<CachedPermission> {
  // 1. No Notifications API → bail.
  if (!notificationsSupported()) {
    writeCached('unsupported')
    return 'unsupported'
  }

  // 2. If browser permission is already granted or denied, the user
  //    has decided (browser-side). Cache it so we don't keep calling
  //    requestPermission on subsequent call-feature uses.
  const browserPerm = currentPermission()
  if (browserPerm === 'granted' || browserPerm === 'denied') {
    writeCached(browserPerm)
    return browserPerm
  }

  // 3. Browser permission is "default" — but have we asked before?
  //    If yes, don't re-prompt (the user dismissed the previous prompt;
  //    re-prompting would be annoying). They can manually toggle the
  //    site permission in their browser settings if they change their mind.
  const cached = readCached()
  if (cached === 'asked' || cached === 'granted' || cached === 'denied') {
    return 'default'
  }

  // 4. First time — actually request the permission.
  try {
    const result = await Notification.requestPermission()
    if (result === 'granted') {
      writeCached('granted')
      return 'granted'
    } else if (result === 'denied') {
      writeCached('denied')
      return 'denied'
    }
    // result === 'default' — the user dismissed without choosing.
    // Record that we've asked so we don't keep re-prompting.
    writeCached('asked')
    return 'default'
  } catch {
    // Some browsers (older Safari) throw on requestPermission.
    writeCached('unsupported')
    return 'unsupported'
  }
}

/**
 * Show a desktop notification — but ONLY if:
 *   1. Permission has been granted (browser-side).
 *   2. The page is currently hidden (the user is on another tab).
 *
 * If the page is visible, we silently skip — the user will see the
 * in-app toast/UI update which is more contextual.
 *
 * Returns true if a notification was actually shown, false otherwise.
 */
export function showNotification(
  title: string,
  body: string,
  options?: { tag?: string; onClick?: () => void },
): boolean {
  if (!notificationsSupported()) return false
  if (currentPermission() !== 'granted') return false
  if (typeof document !== 'undefined' && !document.hidden) return false

  try {
    const n = new Notification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icon-96.png',
      tag: options?.tag,
      // silent: false — we want the OS to ring.
    })
    if (options?.onClick) {
      n.onclick = () => {
        window.focus()
        options.onClick!()
        n.close()
      }
    }
    // Auto-close after 8 seconds — long enough to be noticed, short
    // enough not to pile up if multiple arrive.
    setTimeout(() => n.close(), 8000)
    return true
  } catch {
    return false
  }
}

/**
 * Convenience wrapper: show a notification for an incoming chat message.
 * The `tag` dedupes notifications from the same channel so the user
 * sees one "X new messages" toast rather than 5 separate ones.
 */
export function notifyChatMessage(senderName: string, body: string, channelId?: string): void {
  showNotification(`💬 ${senderName}`, body, {
    tag: channelId ? `chat:${channelId}` : 'chat',
    onClick: () => {
      // Dispatch a custom event so the chat widget can open itself.
      window.dispatchEvent(new CustomEvent('datxevui:open-chat'))
    },
  })
}

/**
 * Convenience wrapper: show a notification for an incoming audio call.
 */
export function notifyIncomingCall(fromName: string): void {
  showNotification(`📞 Cuộc gọi đến từ ${fromName}`, 'Nhấn để trả lời cuộc gọi', {
    tag: 'audio-call',
    onClick: () => {
      window.dispatchEvent(new CustomEvent('datxevui:open-call'))
    },
  })
}

/**
 * For debugging / settings UI — show what's currently cached.
 */
export function debugNotificationState(): { cached: CachedPermission; browser: CachedPermission; askedAt: string | null } {
  let askedAt: string | null = null
  if (typeof window !== 'undefined') {
    try {
      askedAt = window.localStorage.getItem(LS_ASKED_AT_KEY)
    } catch {
      askedAt = null
    }
  }
  return {
    cached: readCached(),
    browser: currentPermission(),
    askedAt,
  }
}
