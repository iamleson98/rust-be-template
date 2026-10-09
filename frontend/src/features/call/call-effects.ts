import { useEffect, useRef, useState } from 'react'
import { playSound, startRingTone } from '@/lib/sound-effects'
import type { CallState } from './audio-call-client'

/** Seconds elapsed while `active`; back to 0 when the call ends. */
export function useCallDuration(active: boolean): number {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => {
      clearInterval(id)
      setSeconds(0)
    }
  }, [active])
  return seconds
}

type WakeLockApi = { request(type: 'screen'): Promise<{ release(): Promise<void> }> }

/** Keeps the screen on during a call (the proximity sensor would otherwise lock it and drop the call). */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock
    if (!active || !wakeLock) return
    let lock: { release(): Promise<void> } | null = null
    let cancelled = false
    const acquire = async () => {
      try {
        const sentinel = await wakeLock.request('screen')
        if (cancelled) void sentinel.release()
        else lock = sentinel
      } catch {
        // not HTTPS, denied or screen off: calls work without it
      }
    }
    // Mobile browsers drop the lock when the tab is backgrounded.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire()
    }
    void acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      lock?.release().catch(() => {})
    }
  }, [active])
}

/**
 * The call's audio cues: a looping ring while dialling or ringing, a chime
 * when it connects, and a closing tone when a connected call ends (an
 * unanswered call that is cancelled stays silent).
 */
export function useCallSounds(state: CallState) {
  const stopRing = useRef<(() => void) | null>(null)
  const previous = useRef<CallState>('idle')

  useEffect(() => {
    const was = previous.current
    previous.current = state
    stopRing.current?.()
    stopRing.current = null
    if (state === 'calling') stopRing.current = startRingTone('ring')
    else if (state === 'incoming') stopRing.current = startRingTone('incoming')
    else if (state === 'active') playSound('connect')
    else if (was === 'active' && (state === 'ended' || state === 'idle')) playSound('end')
  }, [state])

  useEffect(() => () => stopRing.current?.(), [])
}
