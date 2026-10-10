import { useState } from 'react'
import { coversBrand, useMyCoupons } from '@/features/campaigns/api'

/**
 * The customer's coupon at checkout. It applies by itself when it is unused
 * and covers this trip's operator; the customer may switch it off to keep it
 * for a later trip. The discount never exceeds the price (the server clamps
 * it the same way).
 */
export function useCheckoutCoupon(brandId: string | null | undefined, subtotal: number) {
  const coupon = useMyCoupons().data?.active ?? null
  const [optedOut, setOptedOut] = useState(false)
  const usable = !!coupon && coupon.status === 'held' && coversBrand(coupon, brandId)
  const applied = usable && !optedOut
  const worth = coupon ? Math.min(coupon.amount, Math.max(0, subtotal)) : 0
  return {
    coupon,
    /** Unused and valid for this operator. */
    usable,
    applied,
    setApplied: (on: boolean) => setOptedOut(!on),
    /** What it takes off this booking when applied. */
    worth,
    discount: applied ? worth : 0,
    /** What the booking hold sends. */
    couponId: applied ? coupon.id : undefined,
  }
}

export type CheckoutCoupon = ReturnType<typeof useCheckoutCoupon>
