/**
 * Parse `yyyy-MM-dd` (anything after the first ten characters is ignored) into
 * a local-time Date, or null for text that is not a real calendar day. Written
 * without a date library: it is read on the first screen, and the libraries
 * load only once a calendar opens.
 */
export function parseIsoDate(value: string | null | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '')
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(2000, 0, 1)
  date.setFullYear(year, month - 1, day)
  const real =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
  return real ? date : null
}
