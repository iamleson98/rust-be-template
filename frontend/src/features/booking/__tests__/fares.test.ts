import { describe, expect, it } from 'vitest'
import { passengerType, ticketPrice } from '../fares'

const policy = { maxAge: 10, discountPercent: 25 }

describe('fares', () => {
  it('only treats passengers as children when the brand sells child tickets', () => {
    expect(passengerType(6, policy)).toBe('child')
    expect(passengerType(10, policy)).toBe('child')
    expect(passengerType(11, policy)).toBe('adult')
    expect(passengerType(6, null)).toBe('adult')
  })

  it('charges children the child price when the seat has one', () => {
    expect(ticketPrice({ price: 400_000, childPrice: 300_000 }, 'child')).toBe(300_000)
    expect(ticketPrice({ price: 400_000, childPrice: 300_000 }, 'adult')).toBe(400_000)
    expect(ticketPrice({ price: 400_000 }, 'child')).toBe(400_000)
  })
})
