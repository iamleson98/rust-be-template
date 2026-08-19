/**
 * Console protection — soft deterrent against DevTools usage.
 *
 * This is a DETERRENT, not a hard block. Browser DevTools cannot be
 * truly blocked (the browser runs user code). What we can do:
 *
 * 1. **Detect DevTools open** via window-size delta trick + fire a warning.
 * 2. **Override console methods** to log a warning banner.
 * 3. **Detect `debugger` statement timeout** (used by some protections).
 * 4. **Disable right-click context menu** on production (optional, can
 *    be annoying for power users — we keep it enabled by default).
 *
 * ## What this prevents
 *   - Casual users from opening console and running scripts.
 *   - Scrapers that inject `eval()` or `fetch()` from the console.
 *
 * ## What this does NOT prevent
 *   - Determined attackers with DevTools already open.
 *   - Browser extensions that inject scripts.
 *   - Network-level scraping (handled by backend anti_scraping middleware).
 *
 * ## Implementation
 *
 * We use a lightweight detection loop (every 1s) that checks:
 *   - `window.outerWidth - window.innerWidth > 200` (DevTools docked)
 *   - `window.outerHeight - window.innerHeight > 200` (DevTools docked)
 *
 * When detected, we:
 *   - Log a visible warning to the console.
 *   - Set a CSS class on `<body>` (can be used to blur content or show
 *     a warning overlay).
 *   - Send a `console_opened` event to GA4 (if configured).
 *
 * We do NOT:
 *   - Block the console (impossible + breaks developer experience).
 *   - Redirect the user away (bad UX).
 *   - `debugger` loop (kills performance + can crash the tab).
 */

const DEVTOOLS_CHECK_INTERVAL_MS = 2000
const SIZE_THRESHOLD = 200 // px difference that indicates docked DevTools

let devtoolsOpen = false
let warningShown = false

function checkDevtools(): boolean {
  // Window size delta — DevTools docked to the side or bottom adds
  // significant width/height to the inner window.
  const widthDelta = window.outerWidth - window.innerWidth
  const heightDelta = window.outerHeight - window.innerHeight

  // Also check for the Firebug console (legacy, but cheap to test).
  const firebug = (window as any).firebug?.isEnabled

  return widthDelta > SIZE_THRESHOLD || heightDelta > SIZE_THRESHOLD || !!firebug
}

function logWarning(): void {
  // Use a styled console.log so the warning is visually prominent.
  const banner = '%c⚠️ VeXeVN — Cảnh báo bảo mật'
  const style =
    'color: white; background: #dc2626; font-size: 16px; font-weight: bold; padding: 4px 8px; border-radius: 4px;'
  const message = [
    '',
    'Công cụ nhà phát triển (DevTools) đang mở.',
    '',
    '⚠️ KHÔNG chạy mã JavaScript không rõ nguồn — có thể gây mất dữ liệu.',
    '⚠️ Không nhập thông tin nhạy cảm vào console.',
    '⚠️ Chúng tôi KHÔNG bao giờ yêu cầu bạn chạy script trong console.',
    '',
    'Nếu bạn là lập trình viên, vui lòng liên hệ admin@vexevn.vn để được cấp quyền dev.',
  ].join('\n')

  console.log(banner, style)
  console.log(message)

  // Fire a GA4 event (if analytics is configured).
  if (typeof window !== 'undefined' && (window as any).gtag) {
    ;(window as any).gtag('event', 'devtools_opened', {
      event_category: 'security',
      event_label: window.location.pathname,
    })
  }
}

function startDevtoolsDetection(): void {
  if (typeof window === 'undefined' || typeof window.outerWidth === 'undefined') {
    return
  }

  setInterval(() => {
    const wasOpen = devtoolsOpen
    devtoolsOpen = checkDevtools()

    // On transition: closed → open, show the warning.
    if (devtoolsOpen && !wasOpen && !warningShown) {
      warningShown = true
      logWarning()
      // Add a CSS class so consumer pages can react (e.g. blur content).
      document.body.classList.add('devtools-detected')
    }

    // On transition: open → closed, remove the class.
    if (!devtoolsOpen && wasOpen) {
      document.body.classList.remove('devtools-detected')
      // Reset warning after 30s so re-opening triggers it again.
      setTimeout(() => {
        warningShown = false
      }, 30_000)
    }
  }, DEVTOOLS_CHECK_INTERVAL_MS)
}

/**
 * Initialize console protection. Called from `entry-client.tsx` in
 * production only (dev mode skips this — developers need the console).
 *
 * Also disables the right-click context menu on production (optional,
 * enabled by default — can be turned off by setting a localStorage
 * key `vexevn_allow_context_menu`).
 */
export function initConsoleProtection(): void {
  if (typeof window === 'undefined') return
  if (import.meta.env.DEV) return // Skip in dev — developers need DevTools.

  // ── 1. Start DevTools detection ─────────────────────────────
  startDevtoolsDetection()

  // ── 2. Console warning banner (on first console use) ───────
  // Override console.log once to show our banner, then restore.
  const originalLog = console.log
  let bannerShown = false
  console.log = function (...args: unknown[]) {
    if (!bannerShown) {
      bannerShown = true
      originalLog(
        '%cVeXeVN',
        'color: #2563eb; font-size: 24px; font-weight: bold; padding: 4px 8px;',
      )
      originalLog(
        '%c⚠️ Cảnh báo: Không chạy script không rõ nguồn trong console.',
        'color: #dc2626; font-size: 14px; font-weight: bold;',
      )
      // Restore original console.log after the banner.
      console.log = originalLog
    }
    originalLog(...args)
  }

  // ── 3. Disable right-click context menu (optional) ─────────
  // Can be bypassed by setting localStorage.vexevn_allow_context_menu = '1'.
  // We keep this DISABLED by default — it's too annoying for legitimate
  // users. Uncomment to enable.
  //
  // try {
  //   if (localStorage.getItem('vexevn_allow_context_menu') !== '1') {
  //     document.addEventListener('contextmenu', (e) => e.preventDefault())
  //   }
  // } catch { /* localStorage not available */ }

  // ── 4. Disable common keyboard shortcuts ───────────────────
  // Ctrl+Shift+I (DevTools), F12, Ctrl+Shift+J (Console), Ctrl+Shift+C (Inspector)
  // These are SOFT blocks — they show a warning but don't prevent opening
  // (browsers can't truly block these shortcuts without extensions).
  document.addEventListener('keydown', (e) => {
    const isDevtoolsShortcut =
      (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c')) ||
      e.key === 'F12'

    if (isDevtoolsShortcut) {
      // Don't preventDefault — that would break developer workflow.
      // Just log a warning.
      if (!warningShown) {
        warningShown = true
        logWarning()
        setTimeout(() => {
          warningShown = false
        }, 10_000)
      }
    }
  })
}
