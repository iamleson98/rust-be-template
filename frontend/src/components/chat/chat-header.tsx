'use client'

/**
 * ChatHeader — the gradient header bar of the customer-facing chat panel.
 *
 * Extracted from the original `chat-widget.tsx`. Shows the current view
 * title, the live WebSocket connection status, the number of online
 * employees (when relevant) and the minimize/close buttons. Also owns
 * the "back to list" affordance when the conversation view is active.
 */

import {
  Headset,
  X,
  Minus,
  ArrowLeft,
  WifiOff,
  CircleCheck,
  Phone,
} from 'lucide-react'
import type { CustomerChannel as Channel, View } from './_shared'

export function ChatHeader({
  view,
  activeChannel,
  connected,
  employeesOnline,
  assigneeName,
  botActive,
  showBack,
  onCall,
  onMinimize,
  onClose,
  onBackToList,
}: {
  view: View
  activeChannel: Channel | null
  connected: boolean
  employeesOnline: number
  /** Live assignee name (three-role routing) — null while unassigned. */
  assigneeName?: string | null
  /** True when no staff is online — the AI bot owns support. */
  botActive?: boolean
  /** The back action is reserved for returning from the embedded call. */
  showBack?: boolean
  onCall?: () => void
  onMinimize: () => void
  onClose: () => void
  onBackToList: () => void
}) {
  const title = view === 'conversation' && activeChannel ? activeChannel.topic : 'Hỗ trợ DatXeVui'

  return (
    <div className="bg-linear-to-r from-rose-600 to-rose-700 text-white px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-2.5 min-w-0">
        {showBack && (
          <button
            onClick={onBackToList}
            className="hover:bg-white/10 rounded p-1 -ml-1"
            aria-label="Quay lại"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="h-9 w-9 rounded-full bg-white/20 flex items-center justify-center shrink-0 relative">
          <Headset className="h-5 w-5" />
          {/* Always-on "active" pulse — customer always sees an agent is
              available (NullClaw AI replies instantly if no human is online). */}
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-rose-600 animate-pulse" />
        </div>
        <div className="min-w-0">
          <div className="font-bold text-sm truncate">{title}</div>
          <div className="text-[11px] text-rose-100 flex items-center gap-1 truncate">
            {connected ? (
              assigneeName ? (
                <>
                  <CircleCheck className="h-3 w-3 text-emerald-300 shrink-0" />
                  <span className="truncate">{assigneeName} đang hỗ trợ bạn</span>
                </>
              ) : botActive ? (
                <>
                  <CircleCheck className="h-3 w-3 text-violet-300 shrink-0" />
                  <span>Trợ lý AI đang hỗ trợ — nhân viên sẽ tiếp nhận sớm</span>
                </>
              ) : (
                <>
                  <CircleCheck className="h-3 w-3 text-emerald-300 shrink-0" />
                  <span>Nhân viên đang trực tuyến</span>
                  {employeesOnline > 0 && <span className="ml-1 opacity-80">• {employeesOnline} NV</span>}
                </>
              )
            ) : (
              <>
                <WifiOff className="h-3 w-3" /> Đang kết nối...
              </>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {onCall && (
          <button
            type="button"
            onClick={onCall}
            className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            aria-label="Gọi nhân viên hỗ trợ"
            title="Gọi nhân viên hỗ trợ"
          >
            <Phone className="h-4 w-4" />
          </button>
        )}
        <button onClick={onMinimize} className="hover:bg-white/10 rounded p-1.5" aria-label="Thu nhỏ">
          <Minus className="h-4 w-4" />
        </button>
        <button onClick={onClose} className="hover:bg-white/10 rounded p-1.5" aria-label="Đóng">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
