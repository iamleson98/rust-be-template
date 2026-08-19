/**
 * Tests for the analytics module — trackPageView, trackEvent, etc.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  trackPageView,
  trackEvent,
  trackSearch,
  trackViewItem,
  trackBeginCheckout,
  trackPurchase,
  isAnalyticsEnabled,
} from '@/lib/analytics'

describe('analytics', () => {
  beforeEach(() => {
    // Reset window.gtag between tests
    ;(window as any).gtag = undefined
  })

  describe('trackPageView', () => {
    it('calls window.gtag with page_view event', () => {
      const gtag = vi.fn()
      ;(window as any).gtag = gtag

      trackPageView('/search', 'Tìm chuyến xe')

      expect(gtag).toHaveBeenCalledWith('event', 'page_view', expect.objectContaining({
        page_path: '/search',
        page_title: 'Tìm chuyến xe',
      }))
    })

    it('is a no-op when gtag is not available', () => {
      expect(() => trackPageView('/', 'Home')).not.toThrow()
    })
  })

  describe('trackEvent', () => {
    it('calls window.gtag with custom event', () => {
      const gtag = vi.fn()
      ;(window as any).gtag = gtag

      trackEvent('custom_event', { param1: 'value1' })

      expect(gtag).toHaveBeenCalledWith('event', 'custom_event', { param1: 'value1' })
    })

    it('is a no-op when gtag is not available', () => {
      expect(() => trackEvent('test', {})).not.toThrow()
    })
  })

  describe('trackSearch', () => {
    it('fires a search event with trip params', () => {
      const gtag = vi.fn()
      ;(window as any).gtag = gtag

      trackSearch({
        from: 'Hà Nội',
        to: 'Đà Nẵng',
        date: '2025-01-01',
        adults: 1,
        children: 0,
      })

      expect(gtag).toHaveBeenCalledWith('event', 'search', expect.objectContaining({
        from: 'Hà Nội',
        to: 'Đà Nẵng',
        adults: 1,
      }))
    })
  })

  describe('trackViewItem', () => {
    it('fires a view_item event with item data', () => {
      const gtag = vi.fn()
      ;(window as any).gtag = gtag

      trackViewItem({
        itemId: 'trip-123',
        itemName: 'Hà Nội → Đà Nẵng',
        price: 350000,
        currency: 'VND',
        brand: 'Phương Trang',
      })

      expect(gtag).toHaveBeenCalledWith('event', 'view_item', expect.objectContaining({
        currency: 'VND',
        value: 350000,
      }))
    })
  })

  describe('trackBeginCheckout', () => {
    it('fires a begin_checkout event', () => {
      const gtag = vi.fn()
      ;(window as any).gtag = gtag

      trackBeginCheckout({
        itemId: 'trip-123',
        value: 350000,
        currency: 'VND',
        seatCount: 2,
      })

      expect(gtag).toHaveBeenCalledWith('event', 'begin_checkout', expect.objectContaining({
        currency: 'VND',
        value: 350000,
      }))
    })
  })

  describe('trackPurchase', () => {
    it('fires a purchase event with transaction ID', () => {
      const gtag = vi.fn()
      ;(window as any).gtag = gtag

      trackPurchase({
        transactionId: 'VX123456',
        value: 350000,
        currency: 'VND',
        itemId: 'trip-123',
        itemName: 'Hà Nội → Đà Nẵng',
        paymentMethod: 'momo',
      })

      expect(gtag).toHaveBeenCalledWith('event', 'purchase', expect.objectContaining({
        transaction_id: 'VX123456',
        value: 350000,
        payment_type: 'momo',
      }))
    })
  })

  describe('isAnalyticsEnabled', () => {
    it('returns a boolean', () => {
      expect(typeof isAnalyticsEnabled()).toBe('boolean')
    })
  })
})
