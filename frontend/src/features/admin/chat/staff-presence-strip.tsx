'use client'

import { Bot } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { relativeTime } from '@/lib/format'
import type { StaffPresenceSnapshot } from '@/features/chat/events'

/**
 * Who can answer right now (pushed over the socket): online staff by availability,
 * recently dropped staff dimmed with when they were last seen, and whether the bot is covering.
 */
export function StaffPresenceStrip({ presence: staffPresence }: { presence: StaffPresenceSnapshot | null }) {
  const t = useT()
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {staffPresence ? (
        <>
          {staffPresence.staff.map((st) => (
            <span
              key={st.userId}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                !st.online
                  ? 'border-slate-200 bg-slate-50 text-slate-400'
                  : st.busy
                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-700'
              }`}
              title={`${st.name} — ${st.role === 'admin' ? t('adminChat.roleAdmin') : t('adminChat.roleStaff')} · ${st.online ? (st.busy ? t('adminChat.onCall') : t('adminChat.available')) : t('adminChat.offline')} · ${st.activeChats} ${t('adminChat.channelNoun')}${st.lastSeenAt ? ` · ${t('adminChat.activeAgo', { time: relativeTime(st.lastSeenAt) })}` : ''}`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  !st.online ? 'bg-slate-300' : st.busy ? 'bg-amber-500' : 'bg-emerald-500'
                }`}
              />
              {st.name}
              {st.role === 'admin' && <span className="text-[10px] uppercase">admin</span>}
            </span>
          ))}
          {staffPresence.offline.map((st) => (
            <span
              key={`off-${st.userId}`}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200/70 border-dashed bg-slate-50/50 px-2 py-0.5 text-[10px] font-medium text-slate-400"
              title={`${st.name} — ${st.role === 'admin' ? t('adminChat.roleAdmin') : t('adminChat.roleStaff')} · ${t('adminChat.offline')} · ${t('adminChat.lastActive')} ${relativeTime(st.lastSeenAt)}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-slate-300/70" />
              {st.name}
              <span className="text-slate-300">{relativeTime(st.lastSeenAt)}</span>
            </span>
          ))}
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
              staffPresence.botActive
                ? 'border-violet-300 bg-violet-100 text-violet-700'
                : 'border-slate-200 bg-slate-50 text-slate-400'
            }`}
            title={
              staffPresence.botActive ? t('adminChat.botActiveTitle') : t('adminChat.botIdleTitle')
            }
          >
            <Bot className="h-3 w-3" />
            Bot {staffPresence.botActive ? t('adminChat.botAssisting') : t('adminChat.botStandby')}
          </span>
        </>
      ) : (
        <span className="text-[10px] text-muted-foreground">{t('adminChat.connectingStaff')}</span>
      )}
    </div>
  )
}
