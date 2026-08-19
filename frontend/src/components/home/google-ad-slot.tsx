'use client'

/**
 * GoogleAdSlot — small, non-intrusive Google AdSense unit.
 *
 * ## Design goals (per user request)
 *
 *   * "Take a small area that don't distract user from their purpose"
 *   * Lazy-loaded (the AdSense script is heavy — only load when the
 *     component mounts).
 *   * Dismissible — the user can close it; the choice is remembered in
 *     localStorage for 24h.
 *   * Mobile-friendly: on mobile it's a thin horizontal banner at the
 *     top of the page content (above the fold but below the header);
 *     on desktop it's a slim 728×90 leaderboard in the same position.
 *   * Only renders on the home (`/`) and search (`/search`) routes —
 *     not on booking flow, trip detail, or admin pages where it would
 *     distract from the user's intent.
 *   * If `NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT` (or `VITE_GOOGLE_ADSENSE_CLIENT`)
 *     isn't set, the component renders nothing — no broken ad slots.
 *
 * ## Configuration
 *
 * Set these in `frontend/.env` (Vite exposes `import.meta.env.VITE_*`):
 *
 *   VITE_GOOGLE_ADSENSE_CLIENT=ca-pub-XXXXXXXXXXXXXXXX
 *   VITE_GOOGLE_ADSENSE_SLOT_HOME=1234567890
 *   VITE_AD_DISMISSIBLE=true   # default: true
 *
 * If the client ID is missing, the slot is silently skipped.
 */

import { useEffect, useState, useRef } from 'react'
import { useRouterState } from '@/router'
import { cn } from '@/lib/utils'
import { X, Sparkles } from 'lucide-react'

const AD_CLIENT = (import.meta.env.VITE_GOOGLE_ADSENSE_CLIENT as string | undefined)?.trim()
const AD_SLOT_HOME = (import.meta.env.VITE_GOOGLE_ADSENSE_SLOT_HOME as string | undefined)?.trim() ?? ''
const AD_SLOT_SEARCH = (import.meta.env.VITE_GOOGLE_ADSENSE_SLOT_SEARCH as string | undefined)?.trim() ?? AD_SLOT_HOME
const DISMISS_KEY = 'vexevn_ad_dismissed_until'
const DISMISS_HOURS = 24

function isDismissed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const ts = Number(localStorage.getItem(DISMISS_KEY) ?? 0)
    if (!ts) return false
    if (Date.now() > ts) {
      localStorage.removeItem(DISMISS_KEY)
      return false
    }
    return true
  } catch { return false }
}

function dismiss(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_HOURS * 3600_000))
  } catch { }
}

export function GoogleAdSlot() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [dismissed, setDismissed] = useState(false)
  const [adLoaded, setAdLoaded] = useState(false)
  const insRef = useRef<HTMLModElement>(null)

  // Reset dismissed state on route change (so a user who dismissed on home
  // still sees the ad on /search — but only if the 24h window hasn't expired).
  useEffect(() => {
    setDismissed(isDismissed())
    setAdLoaded(false)
  }, [pathname])

  // Only show on home and search routes.
  const isHome = pathname === '/'
  const isSearch = pathname === '/search'
  if (!isHome && !isSearch) return null

  // If no AdSense client is configured, render a small placeholder so the
  // layout reserves the space (avoids CLS when ads are added later).
  if (!AD_CLIENT) {
    return null  // silent skip — no broken slots, no layout shift
  }

  if (dismissed) return null

  const slot = isHome ? AD_SLOT_HOME : AD_SLOT_SEARCH
  if (!slot) return null

  // Inject the AdSense script once.
  useEffect(() => {
    if ((window as any).adsbygoogle) return
    const s = document.createElement('script')
    s.async = true
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${AD_CLIENT}`
    s.setAttribute('crossorigin', 'anonymous')
    document.head.appendChild(s)
  }, [])

  // Push the ad to AdSense after the <ins> element mounts.
  useEffect(() => {
    if (!insRef.current) return
    try {
      ((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({})
      setAdLoaded(true)
    } catch { }
  }, [slot])

  return (
    <div
      className={cn(
        'relative mx-auto my-2',
        'w-full max-w-182',
        // Slim height — leaderboard size. On mobile, we cap height at 100px
        // so it doesn't dominate the screen.
        'min-h-22.5 max-h-27.5',
        'overflow-hidden',
        // Subtle border so it's visually distinct from content but not jarring.
        'rounded-lg border border-zinc-200/60 dark:border-zinc-800/60',
        'bg-zinc-50/50 dark:bg-zinc-900/40',
      )}
      role="complementary"
      aria-label="Quảng cáo"
    >
      {/* Dismiss button — top-right, small, subtle */}
      <button
        onClick={() => { dismiss(); setDismissed(true) }}
        aria-label="Đóng quảng cáo"
        className={cn(
          'absolute top-1 right-1 z-10',
          'h-6 w-6 rounded-full',
          'bg-white/70 dark:bg-zinc-900/70 backdrop-blur-sm',
          'hover:bg-white dark:hover:bg-zinc-800',
          'flex items-center justify-center',
          'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200',
          'transition-colors',
        )}
      >
        <X className="h-3 w-3" />
      </button>

      {/* "Ad" label — tiny, top-left, required by AdSense policy */}
      <span className="absolute top-1 left-2 z-10 text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        Quảng cáo
      </span>

      {/* The actual ad unit */}
      <ins
        ref={insRef}
        className="adsbygoogle block"
        style={{ display: 'block', width: '100%', height: '100%' }}
        data-ad-client={AD_CLIENT}
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />

      {/* Fallback shimmer until the ad loads (prevents layout shift). */}
      {!adLoaded && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-1.5 text-xs text-zinc-400 dark:text-zinc-500">
            <Sparkles className="h-3 w-3 animate-pulse" />
            <span>Đang tải...</span>
          </div>
        </div>
      )}
    </div>
  )
}
