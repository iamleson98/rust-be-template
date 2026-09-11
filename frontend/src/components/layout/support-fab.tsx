'use client'

import { useApp } from '@/lib/store'
import { useNavigate } from '@/router'
import { Headset } from 'lucide-react'

export function SupportFab() {
  const { chatOpen, setChatOpen, user } = useApp()
  const navigate = useNavigate()

  if (chatOpen) return null

  return (
    <button
      type="button"
      onClick={() => user ? setChatOpen(true) : navigate({ to: '/login' })}
      aria-label="Mở hộp hỗ trợ"
      title="Hỗ trợ trực tuyến"
      className="group fixed z-60 right-4 bottom-20 md:right-5 md:bottom-5 inline-flex h-11 w-11 md:h-14 md:w-14 items-center justify-center rounded-full bg-linear-to-br from-amber-500 via-orange-500 to-blue-500 text-white ring-1 ring-white/40 transition-transform hover:scale-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-300/60"
    >
      {/* Pulse ring (draws attention) */}
      <span
        aria-hidden="true"
        className="absolute inset-0 -z-10 rounded-full bg-orange-400/40 animate-ping"
        style={{ animationDuration: '2.4s' }}
      />
      <Headset className="h-5 w-5 md:h-6 md:w-6 transition-transform group-hover:-rotate-12" />
      <span className="sr-only">Hỗ trợ trực tuyến</span>
    </button>
  )
}
