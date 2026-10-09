'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Phone, X } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { CallControls, CallNotice } from './call-controls'
import { CallStatus } from './call-status'
import { useAudioCall, type AudioCall } from './use-audio-call'

/** Customers' call controls render inside the support chat body; staff float. */
function CallSurface({ embedded, children }: { embedded: boolean; children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- DOM availability gate
    setTarget(embedded ? document.getElementById('customer-call-surface') : null)
  }, [embedded])
  if (!embedded) return children
  return target ? createPortal(children, target) : null
}

/** Staff's persistent button for noticing and answering calls while the panel is closed. */
function AgentButton({ call }: { call: AudioCall }) {
  const t = useT()
  return (
    <button
      type="button"
      onClick={() => call.setOpen(true)}
      aria-label={t('layout.call.support')}
      className={cn(
        // Left of the SupportFab, which owns the bottom-right corner.
        'fixed right-17 z-40 flex h-10 w-10 items-center justify-center rounded-full border text-white md:right-21 md:h-12 md:w-12',
        'bottom-[calc(5rem+env(safe-area-inset-bottom))] mb-[env(safe-area-inset-bottom)] md:bottom-6',
        'transition-all hover:scale-105 active:scale-95',
        call.presence.agentInCall
          ? 'border-amber-400/30 bg-amber-600 hover:bg-amber-700'
          : 'border-emerald-400/30 bg-emerald-600 hover:bg-emerald-700',
      )}
    >
      <Phone className="h-4 w-4 md:h-5 md:w-5" />
      {call.state === 'incoming' && (
        <span className="absolute -right-1 -top-1 h-3 w-3 animate-ping rounded-full border-2 border-white bg-amber-400" />
      )}
    </button>
  )
}

function AgentHeader({ call }: { call: AudioCall }) {
  const t = useT()
  const { presence, state } = call
  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div
          className={cn(
            'h-2 w-2 rounded-full',
            presence.agentInCall
              ? 'bg-amber-500'
              : presence.online > 0
                ? 'animate-pulse bg-emerald-500'
                : 'bg-zinc-400',
          )}
        />
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
          {t('layout.call.agentPanel')}
        </span>
      </div>
      <button
        onClick={() => {
          if (state === 'active' || state === 'calling' || state === 'connecting') call.hangup()
          call.setOpen(false)
        }}
        aria-label={t('common.close')}
        className="p-1 text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-200"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

/** One-to-one WebRTC audio calls between a customer and support staff; see `useAudioCall`. */
export function AudioCallWidget() {
  const { call, audioRef } = useAudioCall()
  const { isAgent } = call

  return (
    <>
      {/* The remote audio; iOS only autoplays an element that is in the DOM with playsInline. */}
      <audio ref={audioRef} autoPlay playsInline className="hidden" />
      {!call.open && isAgent && <AgentButton call={call} />}
      {call.open && (
        <CallSurface embedded={!isAgent}>
          <div
            className={
              isAgent
                ? 'fixed bottom-3 left-3 right-3 z-70 mb-[env(safe-area-inset-bottom)] rounded-2xl border border-zinc-200 bg-white p-4 md:bottom-6 md:left-auto md:w-80 md:p-5 dark:border-zinc-800 dark:bg-zinc-900'
                : 'flex min-h-0 flex-1 flex-col justify-center bg-white px-6 py-8 dark:bg-zinc-900'
            }
            role="dialog"
            aria-label="Audio call"
          >
            {isAgent && <AgentHeader call={call} />}
            <CallStatus call={call} />
            <CallNotice call={call} />
            <CallControls call={call} />
          </div>
        </CallSurface>
      )}
    </>
  )
}
