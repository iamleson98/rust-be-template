import { describe, expect, it } from 'vitest'
import { searchResolver, type SearchFormValues } from '../schema'

const valid: SearchFormValues = {
  from: 'Hà Nội',
  to: 'Hải Phòng',
  date: '2026-12-01',
  time: '',
  roundTrip: false,
  returnDate: '',
  adults: 1,
  children: 0,
  sort: 'departure',
  vehicleTypes: [],
}

/** What the form library would get back for `values`. */
const check = (patch: Partial<SearchFormValues>) =>
  searchResolver({ ...valid, ...patch }, undefined, {
    fields: {},
    shouldUseNativeValidation: false,
  }) as unknown as Promise<{ values: object; errors: Record<string, { message: string }> }>

describe('searchResolver', () => {
  it('accepts a complete search and trims the places and the day', async () => {
    const { values, errors } = await check({
      from: '  Hà Nội ',
      to: 'Hải Phòng  ',
      date: ' 2026-12-01',
    })
    expect(errors).toEqual({})
    expect(values).toMatchObject({ from: 'Hà Nội', to: 'Hải Phòng', date: '2026-12-01' })
  })

  it('names each missing place or day', async () => {
    const { values, errors } = await check({ from: '   ', to: '', date: '' })
    expect(values).toEqual({})
    expect(Object.keys(errors).sort()).toEqual(['date', 'from', 'to'])
    expect(errors.from.message).toContain('bắt buộc')
  })

  it('needs an adult', async () => {
    const { errors } = await check({ adults: 0 })
    expect(errors.adults.message).toBe('Phải có ít nhất 1 người lớn')
  })

  it('asks a round trip for a return day on or after the outbound day', async () => {
    expect((await check({ roundTrip: true, returnDate: '' })).errors.returnDate.message).toContain(
      'ngày về',
    )
    expect(
      (await check({ roundTrip: true, returnDate: '2026-11-30' })).errors.returnDate.message,
    ).toBe('Ngày về phải sau ngày đi')
    expect((await check({ roundTrip: true, returnDate: '2026-12-01' })).errors).toEqual({})
    // A one-way search has no return day to check.
    expect((await check({ roundTrip: false, returnDate: '2000-01-01' })).errors).toEqual({})
  })
})
