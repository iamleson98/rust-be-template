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

/**
 * What callers may pass to `navigate` / `<Link search>`: any subset, with
 * vehicle types either as an array or already as the URL's `vt`.
 */
export type SearchInput = Partial<SearchParams> & { vt?: string }

/**
 * The address bar's form of the search: vehicle types travel as one
 * comma-separated `vt` (`vt=limousine,sleeper`), never as a JSON array.
 */
export type SearchQuery = Omit<SearchParams, 'vehicleTypes'> & { vt: string }

/** Values omitted from the URL (`stripSearchParams` on the route). */
export const SEARCH_DEFAULTS = {
  from: '',
  to: '',
  date: '',
  adults: 1,
  children: 0,
  sort: 'departure',
  vt: '',
  roundTrip: false,
  returnDate: '',
} satisfies Partial<SearchQuery>

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

/** `a,b` (the `vt=` param), `["a","b"]` (JSON from older links) or a real array. */
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

/** The URL form of parsed params (`vt` instead of `vehicleTypes`). */
export function toQuery({ vehicleTypes, ...rest }: SearchParams): SearchQuery {
  return { ...rest, vt: vehicleTypes.join(',') }
}

/**
 * Navigation input for `/search`: only what differs from the defaults, vehicle
 * types as `vt`. Precise picks keep their coordinates only when both ends are
 * precise; a MIXED pick (one precise end, one plain city) degrades the precise
 * end to its city so the ordinary city-to-city search runs instead of an
 * unresolvable place name.
 */
export function buildSearchInput(input: SearchInput): SearchInput {
  const { vehicleTypes, vt, fromLat, fromLon, toLat, toLon, fromCity, toCity, ...rest } = input
  const out: SearchInput = { ...rest, vt: vehicleTypes ? vehicleTypes.join(',') : vt }
  for (const key of Object.keys(SEARCH_DEFAULTS) as (keyof typeof SEARCH_DEFAULTS)[]) {
    if (out[key] === SEARCH_DEFAULTS[key] || out[key] === undefined) delete out[key]
  }
  const geo = [fromLat, fromLon, toLat, toLon].every(
    (c) => typeof c === 'number' && Number.isFinite(c),
  )
  if (geo) return { ...out, fromLat, fromLon, toLat, toLon }
  if (typeof fromLat === 'number' || typeof toLat === 'number') {
    return { ...out, from: fromCity || out.from, to: toCity || out.to }
  }
  return out
}
