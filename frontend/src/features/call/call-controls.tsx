import { Loader2, Mic, MicOff, Phone, PhoneOff } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { micDeniedGuidance } from './call-quality'
import type { AudioCall } from './use-audio-call'

const ROUND = 'flex h-12 w-12 items-center justify-center rounded-full text-white'

/** Error / microphone-permission notice above the buttons. */
export function CallNotice({ call }: { call: AudioCall }) {
  const t = useT()
  const { error } = call
  if (!error) return null
  if (!error.micDenied) {
    return (
      <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        {error.message}
      </div>
    )
  }
  // Recovering needs a manual browser-permission change: keep the guidance up until the user retries.
  return (
    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <div className="mb-1 font-medium">{error.message}</div>
      <div className="text-amber-700 dark:text-amber-300">{micDeniedGuidance()}</div>
      {!call.isAgent && (
        <button
          type="button"
          onClick={() => {
            call.dismissMicError()
            void call.startCall()
          }}
          className="mt-2 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-700"
        >
          {t('layout.call.retry')}
        </button>
      )}
    </div>
  )
}

/** The buttons for the current state. */
export function CallControls({ call }: { call: AudioCall }) {
  const t = useT()
  const { state, isAgent, presence, micOn, incoming } = call
  const busy = !isAgent && presence.online > 0 && !presence.available

  return (
    <div className="flex items-center justify-center gap-3">
      {state === 'idle' && !isAgent && busy && (
        <div className="flex flex-col items-center gap-2 py-2">
          <div className="text-sm font-medium text-amber-600 dark:text-amber-400">{t('layout.call.agentBusy')}</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">{t('layout.call.busyHint')}</div>
        </div>
      )}
      {state === 'idle' && !isAgent && presence.available && (
        <div className="flex items-center gap-2 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('layout.call.starting')}
        </div>
      )}
      {state === 'idle' && isAgent && (
        <div className="py-2 text-center text-xs text-zinc-500 dark:text-zinc-400">
          {t('layout.call.waitingForCustomer')}
        </div>
      )}
      {(state === 'calling' || state === 'connecting' || state === 'active') && (
        <>
          {state === 'active' && (
            <button
              onClick={call.toggleMic}
              aria-label={micOn ? t('layout.call.mute') : t('layout.call.unmute')}
              className={cn(
                'flex h-12 w-12 items-center justify-center rounded-full transition-colors',
                micOn
                  ? 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700'
                  : 'bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-950 dark:hover:bg-red-900',
              )}
            >
              {micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            </button>
          )}
          <button
            onClick={call.hangup}
            aria-label={t('layout.call.hangup')}
            className={cn(ROUND, 'bg-red-600 transition-colors hover:bg-red-700')}
          >
            <PhoneOff className="h-5 w-5" />
          </button>
        </>
      )}
      {state === 'incoming' && incoming && (
        <>
          <button
            onClick={call.rejectCall}
            aria-label={t('layout.call.decline')}
            className={cn(ROUND, 'bg-red-600 hover:bg-red-700')}
          >
            <PhoneOff className="h-5 w-5" />
          </button>
          <button
            onClick={call.acceptCall}
            aria-label={t('layout.call.accept')}
            className={cn(ROUND, 'animate-pulse bg-emerald-600 hover:bg-emerald-700')}
          >
            <Phone className="h-5 w-5" />
          </button>
        </>
      )}
    </div>
  )
}
