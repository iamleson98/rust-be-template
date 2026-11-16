import { isValid, parse } from 'date-fns'

/** Parse `yyyy-MM-dd` leniently → Date | null. */
export function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = parse(value.slice(0, 10), 'yyyy-MM-dd', new Date())
  return isValid(d) ? d : null
}
