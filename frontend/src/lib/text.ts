/** NFD does not decompose đ/Đ, so they are replaced explicitly. */
const stripTones = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')

/** Diacritic-insensitive form for matching: "Hà Nội" → "ha noi". */
export const noTones = (s: string) => stripTones(s).toLowerCase().trim()

/** Code/URL-safe slug, mirroring the backend: "Giường nằm" → "giuong-nam". */
export const slugify = (s: string) =>
  stripTones(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** Vietnamese mobile number → E.164 (`0901…` / `84901…` → `+84901…`). */
export function normalizePhone(phone: string) {
  const p = phone.replace(/\s/g, '')
  if (p.startsWith('0')) return `+84${p.slice(1)}`
  if (p.startsWith('84')) return `+${p}`
  return p
}

/** The number as Vietnamese forms take it (`+84901…` / `84901…` → `0901…`). */
export function localPhone(phone: string) {
  const p = phone.replace(/\s/g, '')
  if (p.startsWith('+84')) return `0${p.slice(3)}`
  if (p.startsWith('84') && p.length > 10) return `0${p.slice(2)}`
  return p
}
