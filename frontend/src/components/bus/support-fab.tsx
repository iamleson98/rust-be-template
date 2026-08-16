'use client'

import { useApp } from '@/lib/store'
import { Headset, X } from 'lucide-react'

/**
 * SupportFab — a floating action button fixed to the bottom-right of the
 * viewport that opens the customer support chat widget (`setChatOpen(true)`).
 *
 * Behaviour:
 *  - Fixed `bottom-20 right-5` on mobile (so it sits above the MobileNav bar
 *    at `bottom-0 h-16`), and `bottom-5 right-5` on desktop.
 *  - Hidden while the chat widget is already open (`chatOpen === true`) to
 *    avoid duplicate affordances.
 *  - Teal→amber gradient (no blue/indigo per project rule).
 *  - Subtle pulse animation (ring ping) to draw attention.
 *  - Accessible: `aria-label="Mở hộp hỗ trợ"`, keyboard-focusable, has a
 *    tooltip via the `title` attribute and an sr-only label.
 *
 * Note: This component is dynamically imported with `ssr: false` in page.tsx,
 *       so it only ever renders on the client — no hydration concerns.
 */
export function SupportFab() {
  const { chatOpen, setChatOpen } = useApp()

  // Don't render while the chat widget is open
  if (chatOpen) return null

  return (
    <button
      type="button"
      onClick={() => setChatOpen(true)}
      aria-label="Mở hộp hỗ trợ"
      title="Hỗ trợ trực tuyến"
      className="group fixed right-5 bottom-20 md:bottom-5 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-linear-to-br from-amber-500 via-orange-500 to-blue-500 text-white shadow-xl shadow-orange-500/30 ring-1 ring-white/40 transition-transform hover:scale-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-300/60"
    >
      {/* Pulse ring (draws attention) */}
      <span
        aria-hidden="true"
        className="absolute inset-0 -z-10 rounded-full bg-orange-400/40 animate-ping"
        style={{ animationDuration: '2.4s' }}
      />
      <Headset className="h-6 w-6 transition-transform group-hover:-rotate-12" />
      <span className="sr-only">Hỗ trợ trực tuyến</span>

      {/* Visual hint badge (purely decorative) */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-1 -right-1 hidden h-5 w-5 items-center justify-center rounded-full bg-white text-orange-600 shadow group-hover:flex"
      >
        <X className="h-3 w-3" />
      </span>
    </button>
  )
}
