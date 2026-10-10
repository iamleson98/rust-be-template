import { Loader2, PhoneIncoming, PhoneOutgoing, Signal } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { hangupReasonText, type QualityLevel } from './call-quality'
import type { AudioCall, CallQuality } from './use-audio-call'

const BAR_COLOR: Record<QualityLevel, string> = {
  good: 'bg-emerald-500',
  fair: 'bg-amber-500',
  poor: 'bg-red-500',
}
const BARS_LIT: Record<QualityLevel, number> = { good: 3, fair: 2, poor: 1 }

/** Three signal bars coloured by the call's network grade. */
function QualityBars({ level }: { level: QualityLevel }) {
  return (
    <span className="flex items-end gap-0.5" aria-hidden>
      {[1, 2, 3].map((bar) => (
        <span
          key={bar}
          className={cn(
            'w-1 rounded-sm transition-colors',
            BAR_COLOR[level],
            bar <= BARS_LIT[level] ? 'opacity-100' : 'opacity-25',
          )}
          style={{ height: `${4 + bar * 3}px` }}
        />
      ))}
    </span>
  )
}

const MUTED_TEXT = 'text-sm text-zinc-600 dark:text-zinc-300'

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col items-center gap-2">{children}</div>
}

function ActiveCall({
  duration,
  micOn,
  quality,
}: {
  duration: number
  micOn: boolean
  quality: CallQuality | null
}) {
  const t = useT()
  const numbers = quality
    ? [
        quality.rttMs != null && t('layout.call.rtt', { value: quality.rttMs }),
        quality.jitterMs != null && t('layout.call.jitter', { value: quality.jitterMs }),
        quality.lossPct != null && t('layout.call.packetLoss', { value: quality.lossPct }),
      ]
        .filter(Boolean)
        .join(' · ')
    : ''
  return (
    <Centered>
      <div className="flex items-center gap-1.5">
        {quality ? (
          <QualityBars level={quality.level} />
        ) : (
          <Signal className="h-4 w-4 text-emerald-500" />
        )}
        <span className="font-mono text-2xl font-semibold text-zinc-800 dark:text-zinc-100">
          {Math.floor(duration / 60)}:{String(duration % 60).padStart(2, '0')}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        {quality?.relayed && (
          <span
            className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            title={t('layout.call.turnRelay')}
          >
            TURN relay
          </span>
        )}
        <span>{micOn ? t('layout.call.micOn') : t('layout.call.micOff')}</span>
        {quality && (
          <span className="cursor-help" title={numbers || undefined}>
            ({quality.rttMs != null ? `${quality.rttMs} ms` : '…'}
            {quality.lossPct != null ? `, ${quality.lossPct}%` : ''})
          </span>
        )}
      </div>
    </Centered>
  )
}

/** The headline of the call panel for the current state. */
export function CallStatus({ call }: { call: AudioCall }) {
  const t = useT()
  const { isAgent, state, presence, incoming } = call
  const statusText = isAgent
    ? state === 'active'
      ? t('layout.call.inCall')
      : state === 'calling' || state === 'connecting'
        ? t('layout.call.calling')
        : t('layout.call.ready')
    : presence.online > 0
      ? t(presence.available ? 'layout.call.agentOnline' : 'layout.call.agentBusy')
      : t('layout.call.agentOffline')

  return (
    <div className="mb-4 text-center">
      <div className="mb-1 text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {statusText}
      </div>
      {state === 'idle' && (
        <div className={MUTED_TEXT}>
          {isAgent
            ? t('layout.call.agentIdleHint')
            : presence.online === 0
              ? t('layout.call.noAgentsHint')
              : presence.available
                ? t('layout.call.tapToCall')
                : t('layout.call.agentOnOtherCall')}
        </div>
      )}
      {state === 'calling' && (
        <Centered>
          <PhoneOutgoing className="h-8 w-8 animate-pulse text-emerald-600" />
          <div className={MUTED_TEXT}>{t('layout.call.calling')}</div>
        </Centered>
      )}
      {state === 'incoming' && incoming && (
        <Centered>
          {incoming.callerAvatar && (
            <img
              src={incoming.callerAvatar}
              alt=""
              className="h-14 w-14 animate-pulse rounded-full object-cover ring-2 ring-emerald-500/40"
            />
          )}
          <PhoneIncoming className="h-8 w-8 animate-bounce text-emerald-600" />
          <div className={MUTED_TEXT}>
            {isAgent
              ? t('layout.call.incomingFromCustomer', {
                  name: incoming.callerName ?? t('users.roleUser'),
                })
              : t('layout.call.incomingFromAgent', {
                  name: incoming.callerName ?? t('chat.agentName'),
                })}
          </div>
        </Centered>
      )}
      {state === 'connecting' && (
        <Centered>
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          <div className={MUTED_TEXT}>{t('chatWidget.connecting')}</div>
        </Centered>
      )}
      {state === 'active' && (
        <ActiveCall duration={call.duration} micOn={call.micOn} quality={call.quality} />
      )}
      {state === 'ended' && (
        <div className="text-sm text-zinc-500 dark:text-zinc-400">
          {hangupReasonText(call.endReason, isAgent)}
        </div>
      )}
    </div>
  )
}
