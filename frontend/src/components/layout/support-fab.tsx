'use client'

import { useApp } from '@/lib/store'
import { Headset, X } from 'lucide-react'

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
      className="group fixed right-5 bottom-20 md:bottom-5 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-linear-to-br from-amber-500 via-orange-500 to-blue-500 text-white ring-1 ring-white/40 transition-transform hover:scale-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-300/60"
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
        className="pointer-events-none absolute -top-1 -right-1 hidden h-5 w-5 items-center justify-center rounded-full bg-white text-orange-600 group-hover:flex"
      >
        <X className="h-3 w-3" />
      </span>
    </button>
  )
}
