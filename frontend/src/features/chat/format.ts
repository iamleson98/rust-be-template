type Translate = (key: string) => string

/** `08:30`, or '' for an invalid date. */
export function messageTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

function dayHeading(iso: string, t: Translate): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const daysAgo = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000)
  if (daysAgo === 0) return t('adminChat.today')
  if (daysAgo === 1) return t('adminChat.yesterday')
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** "Today" / "Yesterday" / `dd/MM/yyyy` when `iso` starts a new calendar day after `prevIso`, else null. */
export function dayBreak(prevIso: string | undefined, iso: string, t: Translate): string | null {
  const sameDay = prevIso && new Date(prevIso).toDateString() === new Date(iso).toDateString()
  return iso && !sameDay ? dayHeading(iso, t) : null
}
