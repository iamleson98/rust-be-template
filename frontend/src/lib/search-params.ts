/**
 * The `/search` URL contract, in one place: the route's `validateSearch`,
 * the search form's deep-link seeding and every `<Link search=…>` go
 * through here. Parsing is tolerant — anything invalid falls back to its
 * default instead of throwing — and only non-default values are written
 * back so URLs stay clean.
 */

export const SORT_KEYS = ['departure', 'price', 'rating'] as const
export type SortKey = (typeof SORT_KEYS)[number]

export type SearchParams = {
  from: string
  to: string
  /** `YYYY-MM-DD`, or '' when no date is picked. */
  date: string
  adults: number
  children: number
  sort: SortKey
  vehicleTypes: string[]
  roundTrip: boolean
  returnDate: string
  /** Precise-pick coordinates: all four together switch to the geo search. */
  fromLat?: number
  fromLon?: number
  toLat?: number
  toLon?: number
  /** Province of a precise pick, used when only one end is precise. */
  fromCity?: string
  toCity?: string
}

/** What callers may pass to `navigate` / `<Link search>`: any subset. */
export type SearchInput = Partial<SearchParams>

/** Values omitted from the URL (`stripSearchParams` on the route). */
export const SEARCH_DEFAULTS = {
  from: '',
  to: '',
  date: '',
  adults: 1,
  children: 0,
  sort: 'departure',
  vehicleTypes: [],
  roundTrip: false,
  returnDate: '',
} satisfies Partial<SearchParams>

const YMD = /^\d{4}-\d{2}-\d{2}$/

const text = (v: unknown) => (typeof v === 'string' ? v : '')
const day = (v: unknown) => (typeof v === 'string' && YMD.test(v) ? v : '')
const flag = (v: unknown) => v === true || v === '1' || v === 'true'

function num(v: unknown): number | undefined {
  if (typeof v !== 'number' && (typeof v !== 'string' || v.trim() === '')) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

const atLeast = (v: unknown, min: number) => Math.max(min, Math.trunc(num(v) ?? min))

/** `["a","b"]` (the router's JSON), `a,b` (the legacy `vt=` param) or a real array. */
function list(v: unknown): string[] {
  let items: unknown[] = []
  if (Array.isArray(v)) items = v
  else if (typeof v === 'string') {
    try {
      const parsed: unknown = v.startsWith('[') ? JSON.parse(v) : undefined
      items = Array.isArray(parsed) ? parsed : v.split(',')
    } catch {
      items = v.split(',')
    }
  }
  return items.map((s) => String(s).trim()).filter(Boolean)
}

/** Parse a raw search object (router-parsed values or `URLSearchParams` strings). */
export function parseSearch(raw: Record<string, unknown>): SearchParams {
  const sort = SORT_KEYS.find((k) => k === raw.sort) ?? SEARCH_DEFAULTS.sort
  const coords = [raw.fromLat, raw.fromLon, raw.toLat, raw.toLon].map(num)
  const precise = coords.every((c) => c !== undefined)
  const [fromLat, fromLon, toLat, toLon] = precise ? coords : []
  return {
    from: text(raw.from),
    to: text(raw.to),
    date: day(raw.date),
    adults: atLeast(raw.adults, 1),
    children: atLeast(raw.children, 0),
    sort,
    vehicleTypes: list(raw.vehicleTypes ?? raw.vt),
    roundTrip: flag(raw.roundTrip),
    returnDate: day(raw.returnDate),
    fromLat,
    fromLon,
    toLat,
    toLon,
    fromCity: text(raw.fromCity) || undefined,
    toCity: text(raw.toCity) || undefined,
  }
}

/**
 * Navigation input for `/search`. Precise picks keep their coordinates
 * only when both ends are precise; a MIXED pick (one precise end, one
 * plain city) degrades the precise end to its city so the ordinary
 * city-to-city search runs instead of an unresolvable place name.
 */
export function buildSearchInput(p: SearchInput): SearchInput {
  const { fromLat, fromLon, toLat, toLon, fromCity, toCity, ...rest } = p
  const geo = [fromLat, fromLon, toLat, toLon].every((c) => typeof c === 'number' && Number.isFinite(c))
  if (geo) return { ...rest, fromLat, fromLon, toLat, toLon }
  const half = typeof fromLat === 'number' || typeof toLat === 'number'
  return half ? { ...rest, from: fromCity || rest.from, to: toCity || rest.to } : rest
}
