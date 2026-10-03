'use client'

/**
 * useMyLocation — progressive-accuracy geolocation acquisition.
 *
 * WHY THIS EXISTS: a plain `getCurrentPosition` returns the FIRST fix the
 * browser has, which on real phones is frequently a low-accuracy
 * Wi-Fi/cell-tower position (hundreds of meters to kilometers off). The
 * map then faithfully flies to a WRONG location — exactly the "jump to
 * wrong position" bug users reported. GPS hardware needs a few seconds
 * and a few samples to converge.
 *
 * STRATEGY (mirrors what native maps apps do):
 *  1. `watchPosition` streams fixes as the radio warms up.
 *  2. A fix is ACCEPTED as soon as `accuracy <= goodAccuracyM` (50 m).
 *  3. If no good fix arrives within `graceMs` (4 s), accept the BEST
 *     (smallest-accuracy) fix seen so far — better to fly roughly-right
 *     than to keep spinning.
 *  4. Hard timeout (`timeoutMs`, 12 s) → onError('timeout').
 *  5. Everything is cancellable: `cancel()` / unmount / a new `locate()`
 *     call stops the watch and voids pending callbacks (a late GPS
 *     callback must NEVER clobber a position the user picked manually
 *     in the meantime — that was the second half of the bug).
 *
 * API SHAPE: results are delivered via `onLocated` / `onError` callbacks
 * (kept in a ref, always the latest closure) fired exactly ONCE per
 * accepted fix — deliberately NOT via an effect on the hook's state, so
 * consumers never depend on unstable translator/callback identities in
 * effect deps (that pattern re-fires effects on every render and is how
 * the fly-to-GPS animation used to restart in a loop).
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export type MyLocation = {
  lat: number
  lon: number
  /** Accuracy radius in meters, as reported by the browser. */
  accuracy: number
}

export type MyLocationErrorCode = 'unavailable' | 'denied' | 'timeout'

/** Fix accepted immediately when accuracy is at/below this (meters). */
const GOOD_ACCURACY_M = 50
/** Accept best-so-far after this long without a good fix (ms). */
const GRACE_MS = 4000
/** Give up entirely after this long (ms). */
const TIMEOUT_MS = 12000

export function useMyLocation(
  onLocated: (loc: MyLocation) => void,
  onError?: (code: MyLocationErrorCode) => void,
) {
  // Just the acquisition status — drives the button spinner. The fix
  // itself is delivered via the onLocated callback.
  const [acquiring, setAcquiring] = useState(false)

  // Latest callbacks (ref pattern — the consumer may pass a new closure
  // every render; we always invoke the freshest one, never re-run effects).
  const onLocatedRef = useRef(onLocated)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onLocatedRef.current = onLocated
    onErrorRef.current = onError
  })

  const watchRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Monotonic token: every locate() invalidates previous callbacks.
  const requestRef = useRef(0)
  // Best fix seen during the current acquisition.
  const bestRef = useRef<MyLocation | null>(null)

  const clearTimers = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (graceTimerRef.current) clearTimeout(graceTimerRef.current)
    timerRef.current = null
    graceTimerRef.current = null
  }, [])

  const stopWatch = useCallback(() => {
    if (watchRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchRef.current)
    }
    watchRef.current = null
  }, [])

  /** Stop acquisition and void pending callbacks. */
  const cancel = useCallback(() => {
    requestRef.current += 1
    stopWatch()
    clearTimers()
    bestRef.current = null
    setAcquiring(false)
  }, [stopWatch, clearTimers])

  const finish = useCallback(
    (loc: MyLocation) => {
      stopWatch()
      clearTimers()
      bestRef.current = null
      setAcquiring(false)
      onLocatedRef.current(loc)
    },
    [stopWatch, clearTimers],
  )

  const fail = useCallback(
    (code: MyLocationErrorCode) => {
      stopWatch()
      clearTimers()
      bestRef.current = null
      setAcquiring(false)
      onErrorRef.current?.(code)
    },
    [stopWatch, clearTimers],
  )

  const locate = useCallback(() => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      fail('unavailable')
      return
    }

    // Fresh request: invalidate any previous acquisition's callbacks.
    requestRef.current += 1
    const request = requestRef.current
    stopWatch()
    clearTimers()
    bestRef.current = null
    setAcquiring(true)

    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        if (request !== requestRef.current) return // stale callback
        const { latitude, longitude, accuracy } = pos.coords
        const fix: MyLocation = { lat: latitude, lon: longitude, accuracy: accuracy ?? Infinity }
        if (!(Number.isFinite(fix.lat) && Number.isFinite(fix.lon))) return

        // Keep the best fix seen so far.
        if (!bestRef.current || fix.accuracy < bestRef.current.accuracy) {
          bestRef.current = fix
        }

        if (fix.accuracy <= GOOD_ACCURACY_M) {
          finish(fix)
        }
      },
      (err) => {
        if (request !== requestRef.current) return // stale callback
        // PERMISSION_DENIED is terminal; POSITION_UNAVAILABLE may be
        // transient (radio warming up) — only fail fast on denial.
        if (err.code === err.PERMISSION_DENIED) {
          fail('denied')
        }
      },
      { enableHighAccuracy: true, timeout: TIMEOUT_MS, maximumAge: 0 },
    )

    // Grace period expired → accept the best fix we have (if any).
    graceTimerRef.current = setTimeout(() => {
      if (request !== requestRef.current) return
      if (bestRef.current) finish(bestRef.current)
    }, GRACE_MS)

    // Hard timeout → error (the watch's own timeout also lands here).
    timerRef.current = setTimeout(() => {
      if (request !== requestRef.current) return
      fail('timeout')
    }, TIMEOUT_MS)
  }, [finish, fail, stopWatch, clearTimers])

  // Release the watch + timers on unmount.
  useEffect(
    () => () => {
      requestRef.current += 1
      stopWatch()
      clearTimers()
    },
    [stopWatch, clearTimers],
  )

  return { acquiring, locate, cancel }
}
