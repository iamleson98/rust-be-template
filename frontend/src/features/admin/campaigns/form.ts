/**
 * The campaign editor's draft: what the admin types (strings, Vietnam wall
 * times), turned into a `CampaignInput` and checked by the same rules the
 * server applies (`CampaignService::validate` and `update`), so mistakes
 * show next to their field instead of as a failed save.
 */
import type { AdminCampaignOut, CampaignInput } from '@/api'

export const MAX_TIERS = 20
const MIN_AMOUNT = 1_000
const MAX_AMOUNT = 10_000_000
const MAX_SLOTS = 1_000_000
const MAX_DAYS = 366
const DAY_MS = 86_400_000
const VN_OFFSET_MS = 7 * 3_600_000

export type TierDraft = {
  /** React key; stays put while the admin edits. */
  key: string
  /** Set for a tier the server already has. */
  id?: string
  /** Digits only (VND). */
  amount: string
  slots: string
  /** Coupons handed out from it: its amount is fixed and its slots cannot go below. */
  claimed: number
}

export type CampaignDraft = {
  name: string
  description: string
  /** `YYYY-MM-DDTHH:mm`, Vietnam time (a `datetime-local` value). */
  startsAt: string
  endsAt: string
  couponValidity: 'campaign' | 'permanent'
  allBrands: boolean
  brandIds: string[]
  tiers: TierDraft[]
  paused: boolean
}

/** What a field is wrong about, as i18n keys (with parameters for the slot floor). */
export type DraftErrors = {
  name?: string
  description?: string
  startsAt?: string
  endsAt?: string
  brands?: string
  tiers?: string
  tierRows?: Record<string, { key: string; count?: number }>
}

/** An instant as the Vietnam wall time a `datetime-local` input shows. */
export const toLocalInput = (iso: string) =>
  new Date(Date.parse(iso) + VN_OFFSET_MS).toISOString().slice(0, 16)

/** A `datetime-local` value (Vietnam wall time) as an RFC 3339 instant. */
const fromLocalInput = (value: string) => `${value}:00+07:00`

const instant = (value: string) => (value ? Date.parse(fromLocalInput(value)) : NaN)

const digits = (value: string) => Number(value.replace(/\D/g, '') || 0)

let nextKey = 0
const newKey = () => `tier-${++nextKey}`

export const newTier = (): TierDraft => ({ key: newKey(), amount: '', slots: '', claimed: 0 })

/** A fresh campaign: from the next full hour for a week, one empty tier. */
export function emptyDraft(nowMs: number): CampaignDraft {
  const start = Math.ceil(nowMs / 3_600_000) * 3_600_000
  return {
    name: '',
    description: '',
    startsAt: toLocalInput(new Date(start).toISOString()),
    endsAt: toLocalInput(new Date(start + 7 * DAY_MS).toISOString()),
    couponValidity: 'campaign',
    allBrands: true,
    brandIds: [],
    tiers: [newTier()],
    paused: false,
  }
}

export function draftOf(c: AdminCampaignOut): CampaignDraft {
  return {
    name: c.name,
    description: c.description ?? '',
    startsAt: toLocalInput(c.startsAt),
    endsAt: toLocalInput(c.endsAt),
    couponValidity: c.couponValidity === 'permanent' ? 'permanent' : 'campaign',
    allBrands: c.allBrands,
    brandIds: c.brands.map((b) => b.id),
    tiers: c.tiers.map((t) => ({
      key: newKey(),
      id: t.id,
      amount: String(t.amount),
      slots: String(t.totalSlots),
      claimed: t.claimedSlots,
    })),
    paused: c.paused,
  }
}

/**
 * The request for a draft. An untouched start or end keeps the stored instant
 * (the input only has minutes; the server refuses a moved start once running).
 */
export function inputOf(d: CampaignDraft, original?: AdminCampaignOut): CampaignInput {
  const keep = (value: string, stored: string | undefined) =>
    stored && value === toLocalInput(stored) ? stored : fromLocalInput(value)
  return {
    name: d.name.trim(),
    description: d.description.trim() || null,
    startsAt: keep(d.startsAt, original?.startsAt),
    endsAt: keep(d.endsAt, original?.endsAt),
    couponValidity: d.couponValidity,
    allBrands: d.allBrands,
    brandIds: d.allBrands ? [] : d.brandIds,
    tiers: d.tiers.map((t) => ({
      id: t.id ?? null,
      amount: digits(t.amount),
      totalSlots: digits(t.slots),
    })),
    paused: d.paused,
  }
}

/** The stored campaign as a request, with some fields changed (pause / resume). */
export const inputFrom = (c: AdminCampaignOut, over: Partial<CampaignInput>): CampaignInput => ({
  ...inputOf(draftOf(c), c),
  ...over,
})

/** Σ amount × slots: the most the campaign can cost if every coupon is used. */
export const budgetOf = (d: CampaignDraft) =>
  d.tiers.reduce((sum, t) => sum + digits(t.amount) * digits(t.slots), 0)

/** Whether the start (and, with claims, the coupon validity) is locked for editing. */
export function locks(original: AdminCampaignOut | undefined, nowMs: number) {
  const claimed = !!original && original.tiers.some((t) => t.claimedSlots > 0)
  const started = !!original && Date.parse(original.startsAt) <= nowMs
  return { start: started || claimed, validity: claimed }
}

/** The same rules as the server; empty when the draft can be saved. */
export function validateDraft(
  d: CampaignDraft,
  original: AdminCampaignOut | undefined,
  nowMs: number,
): DraftErrors {
  const errors: DraftErrors = {}
  const name = d.name.trim().length
  if (name < 3 || name > 120) errors.name = 'adminCampaigns.err.name'
  if (d.description.trim().length > 1000) errors.description = 'adminCampaigns.err.description'

  const start = instant(d.startsAt)
  const end = instant(d.endsAt)
  if (Number.isNaN(start)) errors.startsAt = 'adminCampaigns.err.date'
  if (Number.isNaN(end)) errors.endsAt = 'adminCampaigns.err.date'
  else if (!Number.isNaN(start) && end <= start) errors.endsAt = 'adminCampaigns.err.order'
  else if (!Number.isNaN(start) && end - start > MAX_DAYS * DAY_MS)
    errors.endsAt = 'adminCampaigns.err.tooLong'
  else if (end <= nowMs && (!original || d.endsAt !== toLocalInput(original.endsAt)))
    errors.endsAt = 'adminCampaigns.err.endPast'

  if (!d.allBrands && d.brandIds.length === 0) errors.brands = 'adminCampaigns.err.brands'

  if (d.tiers.length === 0 || d.tiers.length > MAX_TIERS)
    errors.tiers = 'adminCampaigns.err.tierCount'
  const rows: NonNullable<DraftErrors['tierRows']> = {}
  const seen = new Set<number>()
  for (const t of d.tiers) {
    const amount = digits(t.amount)
    const slots = digits(t.slots)
    if (amount < MIN_AMOUNT || amount > MAX_AMOUNT || amount % 1_000 !== 0)
      rows[t.key] = { key: 'adminCampaigns.err.amount' }
    else if (seen.has(amount)) rows[t.key] = { key: 'adminCampaigns.err.duplicate' }
    else if (slots < Math.max(1, t.claimed) || slots > MAX_SLOTS)
      rows[t.key] =
        t.claimed > 0
          ? { key: 'adminCampaigns.err.slotsClaimed', count: t.claimed }
          : { key: 'adminCampaigns.err.slots' }
    seen.add(amount)
  }
  if (Object.keys(rows).length > 0) errors.tierRows = rows
  return errors
}

export const hasErrors = (e: DraftErrors) => Object.keys(e).length > 0
