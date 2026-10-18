/**
 * The Vietnamese lunar calendar (âm lịch).
 *
 * Hồ Ngọc Đức's astronomical method (https://www.informatik.uni-leipzig.de/~duc/amlich/),
 * the one Vietnamese calendars use: a lunar month starts on the day of the
 * new moon, the month holding the winter solstice is month 11, and in a year
 * with 13 months the first month without a major solar term is the leap
 * month. Everything is computed for Vietnam's UTC+7 — which is why Tết can
 * differ by a day from China's (UTC+8) New Year.
 */

const TZ = 7
const { floor, sin, PI } = Math

/** Julian day number of a Gregorian date. */
function jdFromDate(dd: number, mm: number, yy: number): number {
  const a = floor((14 - mm) / 12)
  const y = yy + 4800 - a
  const m = mm + 12 * a - 3
  let jd = dd + floor((153 * m + 2) / 5) + 365 * y + floor(y / 4) - floor(y / 100)
  jd += floor(y / 400) - 32045
  if (jd < 2299161) jd = dd + floor((153 * m + 2) / 5) + 365 * y + floor(y / 4) - 32083
  return jd
}

/** Time of the k-th new moon after 1900-01-01 (Julian day, UTC). */
function newMoon(k: number): number {
  const T = k / 1236.85
  const T2 = T * T
  const T3 = T2 * T
  const dr = PI / 180
  let jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3
  jd1 += 0.00033 * sin((166.56 + 132.87 * T - 0.009173 * T2) * dr)
  const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3
  const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3
  const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3
  let c1 = (0.1734 - 0.000393 * T) * sin(M * dr) + 0.0021 * sin(2 * dr * M)
  c1 = c1 - 0.4068 * sin(Mpr * dr) + 0.0161 * sin(dr * 2 * Mpr)
  c1 = c1 - 0.0004 * sin(dr * 3 * Mpr)
  c1 = c1 + 0.0104 * sin(dr * 2 * F) - 0.0051 * sin(dr * (M + Mpr))
  c1 = c1 - 0.0074 * sin(dr * (M - Mpr)) + 0.0004 * sin(dr * (2 * F + M))
  c1 = c1 - 0.0004 * sin(dr * (2 * F - M)) - 0.0006 * sin(dr * (2 * F + Mpr))
  c1 = c1 + 0.001 * sin(dr * (2 * F - Mpr)) + 0.0005 * sin(dr * (2 * Mpr + M))
  const deltaT =
    T < -11
      ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3
      : -0.000278 + 0.000265 * T + 0.000262 * T2
  return jd1 + c1 - deltaT
}

/** The sun's ecliptic longitude at a Julian day (radians, 0..2π). */
function sunLongitude(jdn: number): number {
  const T = (jdn - 2451545.0) / 36525
  const T2 = T * T
  const dr = PI / 180
  const M = 357.5291 + 35999.0503 * T - 0.0001559 * T2 - 0.00000048 * T * T2
  const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2
  let DL = (1.9146 - 0.004817 * T - 0.000014 * T2) * sin(dr * M)
  DL += (0.019993 - 0.000101 * T) * sin(dr * 2 * M) + 0.00029 * sin(dr * 3 * M)
  const L = (L0 + DL) * dr
  return L - PI * 2 * floor(L / (PI * 2))
}

/** Which of the 12 major solar terms (30° sectors) the sun is in at local midnight. */
const solarTerm = (dayNumber: number) => floor((sunLongitude(dayNumber - 0.5 - TZ / 24) / PI) * 6)

/** The local day the k-th new moon falls on. */
const newMoonDay = (k: number) => floor(newMoon(k) + 0.5 + TZ / 24)

/** The day lunar month 11 (the one holding the winter solstice) starts in year `yy`. */
function lunarMonth11(yy: number): number {
  const k = floor((jdFromDate(31, 12, yy) - 2415021) / 29.530588853)
  const nm = newMoonDay(k)
  return solarTerm(nm) >= 9 ? newMoonDay(k - 1) : nm
}

/** Months after month 11 until the leap month (the first with no major solar term). */
function leapMonthOffset(a11: number): number {
  const k = floor((a11 - 2415021.076998695) / 29.530588853 + 0.5)
  let i = 1
  let arc = solarTerm(newMoonDay(k + i))
  let last: number
  do {
    last = arc
    i++
    arc = solarTerm(newMoonDay(k + i))
  } while (arc !== last && i < 14)
  return i - 1
}

export type LunarDate = {
  day: number
  month: number
  year: number
  /** The year's leap (repeated) month. */
  leap: boolean
}

/** The lunar date of a Gregorian day, in Vietnam. */
export function toLunar(date: Date): LunarDate {
  const yy = date.getFullYear()
  const dayNumber = jdFromDate(date.getDate(), date.getMonth() + 1, yy)
  const k = floor((dayNumber - 2415021.076998695) / 29.530588853)
  let monthStart = newMoonDay(k + 1)
  if (monthStart > dayNumber) monthStart = newMoonDay(k)

  let a11 = lunarMonth11(yy)
  let b11 = a11
  let year: number
  if (a11 >= monthStart) {
    year = yy
    a11 = lunarMonth11(yy - 1)
  } else {
    year = yy + 1
    b11 = lunarMonth11(yy + 1)
  }
  const day = dayNumber - monthStart + 1
  const diff = floor((monthStart - a11) / 29)
  let leap = false
  let month = diff + 11
  if (b11 - a11 > 365) {
    const leapDiff = leapMonthOffset(a11)
    if (diff >= leapDiff) {
      month = diff + 10
      leap = diff === leapDiff
    }
  }
  if (month > 12) month -= 12
  if (month >= 11 && diff < 4) year -= 1
  return { day, month, year, leap }
}

const CAN = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý']
const CHI = ['Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi', 'Thân', 'Dậu', 'Tuất', 'Hợi']

/** The lunar year's name in the sexagenary cycle, e.g. 2026 → "Bính Ngọ". */
export const yearName = (lunarYear: number) =>
  `${CAN[(lunarYear + 6) % 10]} ${CHI[(lunarYear + 8) % 12]}`

/** Holidays Vietnamese travel plans around, as i18n keys. */
export type Holiday =
  | 'newYear'
  | 'tet'
  | 'hungKings'
  | 'reunification'
  | 'labourDay'
  | 'nationalDay'
  | 'lanternFestival'
  | 'midAutumn'
  | 'kitchenGods'
  | 'tetEve'

const SOLAR_HOLIDAYS: Record<string, Holiday> = {
  '1/1': 'newYear',
  '30/4': 'reunification',
  '1/5': 'labourDay',
  '2/9': 'nationalDay',
}
const LUNAR_HOLIDAYS: Record<string, Holiday> = {
  '1/1': 'tet',
  '2/1': 'tet',
  '3/1': 'tet',
  '15/1': 'lanternFestival',
  '10/3': 'hungKings',
  '15/8': 'midAutumn',
  '23/12': 'kitchenGods',
}

/** The holiday on `date`, if any (lunar ones never fall in a leap month). */
export function holidayOn(date: Date, lunar: LunarDate = toLunar(date)): Holiday | undefined {
  const solar = SOLAR_HOLIDAYS[`${date.getDate()}/${date.getMonth() + 1}`]
  if (solar) return solar
  if (lunar.leap) return undefined
  const named = LUNAR_HOLIDAYS[`${lunar.day}/${lunar.month}`]
  if (named) return named
  // Giao thừa: the last day of month 12 (the 29th or the 30th).
  if (lunar.month === 12 && lunar.day >= 29) {
    const next = new Date(date)
    next.setDate(date.getDate() + 1)
    const after = toLunar(next)
    if (after.day === 1 && after.month === 1) return 'tetEve'
  }
  return undefined
}
