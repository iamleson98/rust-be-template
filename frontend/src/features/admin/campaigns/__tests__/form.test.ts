/**
 * The campaign editor's rules mirror the server's, so mistakes show next to
 * their field; untouched times keep their stored instant.
 */
import { describe, expect, it } from 'vitest'
import type { AdminCampaignOut } from '@/api'
import {
  budgetOf,
  draftOf,
  emptyDraft,
  inputFrom,
  inputOf,
  locks,
  newTier,
  toLocalInput,
  validateDraft,
  type CampaignDraft,
} from '../form'

const NOW = Date.parse('2026-10-10T03:20:00Z') // 10:20 in Vietnam

const draft = (over: Partial<CampaignDraft> = {}): CampaignDraft => ({
  ...emptyDraft(NOW),
  name: 'Ưu đãi Tết',
  tiers: [{ ...newTier(), amount: '50000', slots: '100' }],
  ...over,
})

const stored: AdminCampaignOut = {
  id: 'c1',
  name: 'Ưu đãi Tết',
  startsAt: '2026-10-01T01:00:30Z',
  endsAt: '2026-10-31T16:59:59Z',
  couponValidity: 'campaign',
  allBrands: false,
  brands: [{ id: 'b1', name: 'Phương Trang', slug: 'phuong-trang' }],
  paused: false,
  state: 'running',
  tiers: [
    { id: 't1', amount: 50000, totalSlots: 100, claimedSlots: 40 },
    { id: 't2', amount: 20000, totalSlots: 500, claimedSlots: 0 },
  ],
  totals: {
    budget: 15_000_000,
    claimed: 40,
    inUse: 3,
    owedCount: 2,
    owedAmount: 100000,
    paidCount: 0,
    paidAmount: 0,
    rejectedCount: 0,
    expiredCount: 0,
  },
  createdAt: '2026-09-30T00:00:00Z',
  updatedAt: '2026-09-30T00:00:00Z',
}

describe('campaign form', () => {
  it('shows instants as Vietnam wall time', () => {
    expect(toLocalInput('2026-10-10T17:30:00Z')).toBe('2026-10-11T00:30')
  })

  it('starts a new campaign at the next full hour for a week', () => {
    const d = emptyDraft(NOW)
    expect(d.startsAt).toBe('2026-10-10T11:00')
    expect(d.endsAt).toBe('2026-10-17T11:00')
    expect(d.allBrands).toBe(true)
    expect(d.tiers).toHaveLength(1)
  })

  it('sends Vietnam times as instants and drops operators for an all-operator campaign', () => {
    const input = inputOf(draft({ brandIds: ['b1'] }))
    expect(input.startsAt).toBe('2026-10-10T11:00:00+07:00')
    expect(input.brandIds).toEqual([])
    expect(input.tiers).toEqual([{ id: null, amount: 50000, totalSlots: 100 }])
  })

  it('keeps the stored start and end when they were not touched', () => {
    const input = inputOf(draftOf(stored), stored)
    // The input has minutes only; the stored start has seconds the server would see as a change.
    expect(input.startsAt).toBe(stored.startsAt)
    expect(input.endsAt).toBe(stored.endsAt)
    expect(input.tiers.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(inputFrom(stored, { paused: true }).paused).toBe(true)
  })

  it('accepts a valid draft', () => {
    expect(validateDraft(draft(), undefined, NOW)).toEqual({})
  })

  it('flags each broken field', () => {
    const d = draft({
      name: 'ab',
      endsAt: '2026-10-10T10:00',
      allBrands: false,
      brandIds: [],
      tiers: [
        { ...newTier(), amount: '1500', slots: '10' },
        { ...newTier(), amount: '20000', slots: '0' },
        { ...newTier(), amount: '20000', slots: '5' },
      ],
    })
    const e = validateDraft(d, undefined, NOW)
    expect(e.name).toBe('adminCampaigns.err.name')
    expect(e.endsAt).toBe('adminCampaigns.err.order')
    expect(e.brands).toBe('adminCampaigns.err.brands')
    expect(Object.values(e.tierRows ?? {}).map((r) => r.key)).toEqual([
      'adminCampaigns.err.amount',
      'adminCampaigns.err.slots',
      'adminCampaigns.err.duplicate',
    ])
  })

  it('refuses a campaign longer than a year or ending in the past', () => {
    expect(validateDraft(draft({ endsAt: '2027-10-12T11:00' }), undefined, NOW).endsAt).toBe(
      'adminCampaigns.err.tooLong',
    )
    const past = draft({ startsAt: '2026-10-01T08:00', endsAt: '2026-10-09T08:00' })
    expect(validateDraft(past, undefined, NOW).endsAt).toBe('adminCampaigns.err.endPast')
  })

  it('keeps claimed slots and locks what claims fix', () => {
    const d = draftOf(stored)
    d.tiers[0] = { ...d.tiers[0], slots: '39' }
    const e = validateDraft(d, stored, NOW)
    expect(Object.values(e.tierRows ?? {})).toEqual([
      { key: 'adminCampaigns.err.slotsClaimed', count: 40 },
    ])
    expect(locks(stored, NOW)).toEqual({ start: true, validity: true })
    expect(locks({ ...stored, startsAt: '2026-11-01T00:00:00Z', tiers: [] }, NOW)).toEqual({
      start: false,
      validity: false,
    })
  })

  it('adds up the most a campaign can cost', () => {
    expect(budgetOf(draftOf(stored))).toBe(50000 * 100 + 20000 * 500)
  })
})
