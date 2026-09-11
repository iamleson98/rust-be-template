'use client'

import { Bot } from 'lucide-react'
import { relativeTime } from '@/lib/types'

/** Live staff presence (WS `staff_presence` broadcasts). */
export type StaffPresence = {
  staff: {
    userId: string
    name: string
    role: string
    online: boolean
    available: boolean
    busy: boolean
    inCall: boolean
    activeChats: number
    lastSeenAt?: string | null
  }[]
  offline?: {
    userId: string
    name: string
    role: string
    lastSeenAt: string
    lastOnlineAt?: string | null
  }[]
  onlineCount: number
  availableCount: number
  botActive: boolean
} | null

/**
 * Staff presence strip — live availability (WS pushes).
 * Employees + admins with online/busy/available state;
 * recently-offline staff render dimmed with a durable
 * "last seen" (DB backstop); the bot chip shows when nobody
 * is online.
 */
export function StaffPresenceStrip({
  staffPresence,
}: {
  staffPresence?: StaffPresence
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {staffPresence ? (
        <>
          {staffPresence.staff.map((st) => (
            <span
              key={st.userId}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${!st.online
                  ? 'border-slate-200 bg-slate-50 text-slate-400'
                  : st.busy
                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                }`}
              title={`${st.name} — ${st.role === 'admin' ? 'Quản trị' : 'Nhân viên'} · ${st.online ? (st.busy ? 'đang gọi điện' : 'sẵn sàng') : 'ngoại tuyến'} · ${st.activeChats} kênh${st.lastSeenAt ? ` · hoạt động ${relativeTime(st.lastSeenAt)}` : ''}`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${!st.online ? 'bg-slate-300' : st.busy ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
              />
              {st.name}
              {st.role === 'admin' && <span className="text-[8px] uppercase">admin</span>}
            </span>
          ))}
          {(staffPresence.offline ?? []).map((st) => (
            <span
              key={`off-${st.userId}`}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200/70 border-dashed bg-slate-50/50 px-2 py-0.5 text-[10px] font-medium text-slate-400"
              title={`${st.name} — ${st.role === 'admin' ? 'Quản trị' : 'Nhân viên'} · ngoại tuyến · hoạt động lần cuối ${relativeTime(st.lastSeenAt)}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-slate-300/70" />
              {st.name}
              <span className="text-slate-300">{relativeTime(st.lastSeenAt)}</span>
            </span>
          ))}
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${staffPresence.botActive
                ? 'border-violet-300 bg-violet-100 text-violet-700'
                : 'border-slate-200 bg-slate-50 text-slate-400'
              }`}
            title={
              staffPresence.botActive
                ? 'Không có nhân viên trực tuyến — bot AI đang hỗ trợ khách'
                : 'Có nhân viên trực tuyến — bot chỉ hỗ trợ khi không ai online'
            }
          >
            <Bot className="h-3 w-3" />
            Bot {staffPresence.botActive ? 'đang hỗ trợ' : 'chờ'}
          </span>
        </>
      ) : (
        <span className="text-[10px] text-muted-foreground">
          Đang kết nối trạng thái nhân viên...
        </span>
      )}
    </div>
  )
}
