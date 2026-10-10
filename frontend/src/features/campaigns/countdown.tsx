import { useEffect, useEffectEvent, useState } from 'react'
import { useT } from '@/lib/i18n'

const pad = (n: number) => String(n).padStart(2, '0')

/** `2d 03:12:45` / `03:12:45` for a span of milliseconds. */
function formatSpan(ms: number, t: ReturnType<typeof useT>): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(total / 86_400)
  const clock = `${pad(Math.floor((total % 86_400) / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`
  return days > 0 ? `${t('campaigns.days', { count: days })} ${clock}` : clock
}

/**
 * The time left until `to`, ticking every second on its own so nothing else
 * re-renders. `skewMs` is the server clock minus this device's clock, so a
 * phone set a few minutes off still counts down to the real moment.
 * `onDone` runs once when it reaches zero.
 */
export function Countdown({
  to,
  skewMs,
  label,
  onDone,
}: {
  to: string
  skewMs: number
  /** The sentence around the time, e.g. `campaigns.endsIn`. */
  label: string
  onDone?: () => void
}) {
  const t = useT()
  const [now, setNow] = useState(Date.now)
  const left = Date.parse(to) - (now + skewMs)
  const done = left <= 0

  useEffect(() => {
    if (done) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [done])

  const finish = useEffectEvent(() => onDone?.())
  useEffect(() => {
    if (done) finish()
  }, [done])

  return (
    <span className="tabular-nums" role="timer" aria-live="off">
      {t(label, { time: formatSpan(left, t) })}
    </span>
  )
}
