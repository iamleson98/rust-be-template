import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useT } from '@/lib/i18n'
import { ensureCallNotificationPermission, notifyIncomingCall } from '@/lib/notifications'
import { isStaffUser, useSession } from '@/stores/session'
import { useUi } from '@/stores/ui'
import type { AudioCallClient, AudioCallEventMap, CallState } from './audio-call-client'
import { useCallDuration, useCallSounds, useWakeLock } from './call-effects'

export type IncomingCall = AudioCallEventMap['incoming']
export type CallQuality = AudioCallEventMap['quality']
export type CallError = {
  message: string
  /** needs a manual browser-permission fix: stays until retried */ micDenied: boolean
}

const NO_PRESENCE = { known: false, online: 0, agentInCall: false, available: false }
/** The customer sees WHY a call ended for this long before the panel folds back into the chat. */
const ENDED_CLOSE_MS = 2600
const ERROR_MS = 4000

function signalingUrl(): string {
  if (typeof window === 'undefined') {
    return `${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080'}/ws-call`
  }
  return `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws-call`
}

/**
 * The call widget's brain: owns the signalling client (loaded on demand so
 * WebRTC stays out of the main bundle), mirrors its events into React
 * state, and wires the cues (ring tones, screen wake lock, duration).
 *
 * Staff connect as soon as they sign in so they can receive calls; a
 * customer connects when the panel opens, and a click on the phone in the
 * chat starts the call itself once an agent is available.
 */
export function useAudioCall() {
  const t = useT()
  const user = useSession((s) => s.user)
  const open = useUi((s) => s.callOpen)
  const setOpen = useUi((s) => s.setCallOpen)
  const isAgent = isStaffUser(user)

  const [state, setState] = useState<CallState>('idle')
  const [presence, setPresence] = useState(NO_PRESENCE)
  const [micOn, setMicOn] = useState(true)
  const [error, setError] = useState<CallError | null>(null)
  const [quality, setQuality] = useState<CallQuality | null>(null)
  const [endReason, setEndReason] = useState<string | null>(null)
  const [incoming, setIncoming] = useState<IncomingCall | null>(null)

  const duration = useCallDuration(state === 'active')
  useWakeLock(state === 'active')
  useCallSounds(state)

  const clientRef = useRef<AudioCallClient | null>(null)
  const ownerRef = useRef<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const autoStarted = useRef(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }, [])
  const flashError = useCallback((message: string) => {
    setError({ message, micDenied: false })
    setTimeout(() => setError(null), ERROR_MS)
  }, [])

  /** The client for the signed-in identity (recreated when the user or role changes). */
  const ensureClient = useCallback(async () => {
    if (!user) throw new Error('Not authenticated')
    const role = isStaffUser(user) ? 'agent' : 'customer'
    const owner = `${user.id}:${role}`
    if (clientRef.current && ownerRef.current === owner) return clientRef.current

    clientRef.current?.dispose()
    clientRef.current = ownerRef.current = null
    setPresence(NO_PRESENCE)
    const { AudioCallClient } = await import('./audio-call-client')
    const client = new AudioCallClient({ signalingUrl: signalingUrl(), userId: user.id, role })
    client.remoteAudioElement = audioRef.current

    client.on('state', (s) => {
      setState(s)
      if (s === 'calling' || s === 'incoming') setMicOn(true) // the client re-enables the mic per call
    })
    client.on('presence', ({ onlineAgents, agentInCall, agentsAvailable }) =>
      setPresence({
        known: true,
        online: onlineAgents,
        agentInCall: agentInCall ?? false,
        // Several agents may be online yet all busy.
        available: agentsAvailable ?? onlineAgents > 0,
      }),
    )
    // Socket gone (agent signed out, network drop): disable calling at once.
    client.on('_close', () => setPresence(NO_PRESENCE))
    client.on('incoming', (call) => {
      setIncoming(call)
      // Desktop notification when the tab is hidden: lead with who is calling.
      notifyIncomingCall(call.callerName ?? (isAgent ? t('users.roleUser') : t('chat.agentName')))
    })
    client.on('quality', setQuality)
    client.on('error', ({ code, message }) => {
      if (code === 'mic-denied') setError({ message, micDenied: true })
      else flashError(message)
    })
    client.on('hangup', ({ reason }) => {
      setEndReason(reason)
      setIncoming(null)
    })
    client.connect()
    clientRef.current = client
    ownerRef.current = owner
    return client
  }, [user, isAgent, t, flashError])

  const resetAttempt = useCallback(() => {
    setError(null)
    setEndReason(null)
    setQuality(null)
    cancelClose() // a retry inside the 'ended' window must not fold the panel mid-dial
  }, [cancelClose])

  const startCall = useCallback(async () => {
    resetAttempt()
    const client = await ensureClient()
    await client.startCall()
  }, [ensureClient, resetAttempt])

  const acceptCall = async () => {
    if (!incoming) return
    resetAttempt()
    const client = await ensureClient()
    await client.acceptCall(incoming.sdp, incoming.from)
    setIncoming(null)
  }

  const rejectCall = async () => {
    if (!incoming) return
    const client = await ensureClient()
    client.rejectCall(incoming.from)
    setIncoming(null)
  }

  const hangup = useCallback(() => clientRef.current?.hangup(), [])

  const toggleMic = () => {
    if (clientRef.current) setMicOn(clientRef.current.toggleMic())
  }

  const dismissMicError = () => setError(null)

  // Connect: staff on sign-in, customers when the panel opens.
  useEffect(() => {
    if (!user || (!isAgent && !open)) return
    let cancelled = false
    ensureClient().catch((e) => {
      if (!cancelled) flashError(t('layout.call.connectFailed', { error: String(e) }))
    })
    if (open) void ensureCallNotificationPermission() // best effort; never blocks the panel
    return () => {
      cancelled = true
    }
  }, [open, user, isAgent, ensureClient, flashError, t])

  // Customer: the phone icon in the chat is the call action itself.
  useEffect(() => {
    if (!open || isAgent) {
      autoStarted.current = false
      return
    }
    if (state !== 'idle' || !presence.available || autoStarted.current) return
    autoStarted.current = true
    startCall().catch(() => {
      autoStarted.current = false
      toast.error(t('layout.call.startFailed'))
      setOpen(false)
    })
  }, [open, isAgent, state, presence.available, startCall, setOpen, t])

  // Customer: nobody to call → say so and close.
  useEffect(() => {
    if (!open || isAgent || !presence.known || state !== 'idle') return
    if (presence.online === 0) toast.info(t('layout.call.noAgentsToast'))
    else if (!presence.available) toast.info(t('layout.call.busyToast'))
    else return
    setOpen(false)
  }, [open, isAgent, presence, state, setOpen, t])

  // Customer: fold the panel back into the chat once the call is over.
  useEffect(() => {
    if (isAgent) return
    if (state === 'ended') {
      cancelClose()
      closeTimer.current = setTimeout(() => {
        closeTimer.current = null
        setOpen(false)
      }, ENDED_CLOSE_MS)
    } else if (state === 'idle' && autoStarted.current && !closeTimer.current) {
      setOpen(false)
    }
  }, [state, isAgent, setOpen, cancelClose])

  // Closing the customer panel mid-call hangs up.
  useEffect(() => {
    if (
      !open &&
      !isAgent &&
      (state === 'calling' || state === 'connecting' || state === 'active')
    ) {
      hangup()
    }
  }, [open, isAgent, state, hangup])

  // The widget outlives logout/login: drop the client when the identity changes.
  useEffect(
    () => () => {
      cancelClose()
      clientRef.current?.dispose()
      clientRef.current = ownerRef.current = null
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the identity changes
    [user?.id, isAgent],
  )

  return {
    call: {
      isAgent,
      open,
      setOpen,
      state,
      presence,
      micOn,
      error,
      quality,
      endReason,
      incoming,
      duration,
      startCall,
      acceptCall,
      rejectCall,
      hangup,
      toggleMic,
      dismissMicError,
    },
    /** Attach to the hidden `<audio>` that plays the remote stream. */
    audioRef,
  }
}

export type AudioCall = ReturnType<typeof useAudioCall>['call']
