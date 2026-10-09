import { useCallback, useEffect, useRef } from 'react'

/** Typing stops being announced after this long without a keystroke. */
const IDLE_MS = 2000

/**
 * Tells the other side "typing" once per burst of keystrokes and "stopped" after
 * `IDLE_MS` of silence, on `stop()`, or when the channel changes or unmounts.
 * `send` reports whether the frame went out; it must be stable.
 */
export function useTypingBroadcast(
  channelId: string | undefined,
  send: (channelId: string, isTyping: boolean) => boolean,
) {
  const burst = useRef<{ active: boolean; timer?: ReturnType<typeof setTimeout> }>({
    active: false,
  })

  const stop = useCallback(() => {
    clearTimeout(burst.current.timer)
    if (burst.current.active && channelId) send(channelId, false)
    burst.current.active = false
  }, [channelId, send])

  const ping = useCallback(() => {
    if (!channelId) return
    if (!burst.current.active) burst.current.active = send(channelId, true)
    clearTimeout(burst.current.timer)
    burst.current.timer = setTimeout(stop, IDLE_MS)
  }, [channelId, send, stop])

  useEffect(() => {
    return stop
  }, [stop])

  return { ping, stop }
}
