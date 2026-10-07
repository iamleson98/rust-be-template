/**
 * Tests for the analytics module — GA4 page views, Google Ads
 * conversion dispatch and click-id capture/persistence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { trackPageView, trackConversion, captureClickIds, getClickIds } from '@/lib/analytics'

const CLICK_IDS_KEY = 'datxevui:ads-click-ids'

describe('analytics', () => {
  beforeEach(() => {
    // Reset the gtag runtime + Ads config between tests
    window.gtag = undefined
    window.__GOOGLE_ADS_CONVERSIONS__ = undefined
    localStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  describe('trackPageView', () => {
    it('calls window.gtag with page_view event', () => {
      const gtag = vi.fn()
      window.gtag = gtag

      trackPageView('/search', 'Tìm chuyến xe')

      expect(gtag).toHaveBeenCalledWith(
        'event',
        'page_view',
        expect.objectContaining({
          page_path: '/search',
          page_title: 'Tìm chuyến xe',
        }),
      )
    })

    it('is a no-op when gtag is not available', () => {
      expect(() => trackPageView('/', 'Home')).not.toThrow()
    })
  })

  describe('trackConversion', () => {
    it('fires a conversion event when gtag + label are configured', () => {
      const gtag = vi.fn()
      window.gtag = gtag
      window.__GOOGLE_ADS_CONVERSIONS__ = { purchase: 'AW-123/DeF-456' }

      trackConversion('purchase', {
        value: 250000,
        currency: 'VND',
        transactionId: 'DXV-8X2',
      })

      expect(gtag).toHaveBeenCalledTimes(1)
      expect(gtag).toHaveBeenCalledWith('event', 'conversion', {
        send_to: 'AW-123/DeF-456',
        value: 250000,
        currency: 'VND',
        transaction_id: 'DXV-8X2',
      })
    })

    it('omits absent payload fields instead of sending undefined', () => {
      const gtag = vi.fn()
      window.gtag = gtag
      window.__GOOGLE_ADS_CONVERSIONS__ = { booking: 'AW-123/AbC-123' }

      trackConversion('booking', { transactionId: 'DXV-8X2' })

      expect(gtag).toHaveBeenCalledWith('event', 'conversion', {
        send_to: 'AW-123/AbC-123',
        transaction_id: 'DXV-8X2',
      })
    })

    it('is a no-op when the event has no configured label', () => {
      const gtag = vi.fn()
      window.gtag = gtag
      window.__GOOGLE_ADS_CONVERSIONS__ = { booking: 'AW-123/AbC-123' }

      expect(() => trackConversion('purchase', { value: 1 })).not.toThrow()
      expect(gtag).not.toHaveBeenCalled()
    })

    it('is a no-op when gtag is not available (labels alone are inert)', () => {
      window.__GOOGLE_ADS_CONVERSIONS__ = { purchase: 'AW-123/DeF-456' }

      expect(() => trackConversion('purchase', { value: 1 })).not.toThrow()
    })

    it('is a no-op when nothing is configured', () => {
      expect(() => trackConversion('booking')).not.toThrow()
    })
  })

  describe('captureClickIds / getClickIds', () => {
    it('captures gclid from the landing URL and persists it', () => {
      window.history.replaceState({}, '', '/?gclid=EAIaIQobChM')

      captureClickIds()

      expect(getClickIds()).toEqual({ gclid: 'EAIaIQobChM' })
    })

    it('captures wbraid and gbraid alongside gclid', () => {
      window.history.replaceState({}, '', '/search?from=hanoi&gbraid=01a&wbraid=01b')

      captureClickIds()

      expect(getClickIds()).toEqual({ gbraid: '01a', wbraid: '01b' })
    })

    it('writes nothing when the URL carries no click ids', () => {
      window.history.replaceState({}, '', '/trips/ha-noi-da-nang')

      captureClickIds()

      expect(localStorage.getItem(CLICK_IDS_KEY)).toBeNull()
      expect(getClickIds()).toEqual({})
    })

    it('a fresh landing overwrites a previous capture (latest click wins)', () => {
      window.history.replaceState({}, '', '/?gclid=old-click')
      captureClickIds()

      window.history.replaceState({}, '', '/?gclid=new-click')
      captureClickIds()

      expect(getClickIds()).toEqual({ gclid: 'new-click' })
    })

    it('internal navigation without ids keeps the previous capture', () => {
      window.history.replaceState({}, '', '/?gclid=keep-me')
      captureClickIds()

      window.history.replaceState({}, '', '/account/trips')
      captureClickIds()

      expect(getClickIds()).toEqual({ gclid: 'keep-me' })
    })

    it('ignores empty-valued params (?gclid=)', () => {
      window.history.replaceState({}, '', '/?gclid=')

      captureClickIds()

      expect(localStorage.getItem(CLICK_IDS_KEY)).toBeNull()
    })

    it('expired captures (90-day TTL) are dropped and cleared', () => {
      window.history.replaceState({}, '', '/?gclid=stale')
      captureClickIds()

      // Age the stored capture past the TTL
      const stored = JSON.parse(localStorage.getItem(CLICK_IDS_KEY)!) as {
        capturedAt: number
      }
      stored.capturedAt -= 91 * 24 * 60 * 60 * 1000
      localStorage.setItem(CLICK_IDS_KEY, JSON.stringify(stored))

      expect(getClickIds()).toEqual({})
      expect(localStorage.getItem(CLICK_IDS_KEY)).toBeNull()
    })

    it('corrupt storage degrades to {} instead of throwing', () => {
      localStorage.setItem(CLICK_IDS_KEY, '{not json')

      expect(getClickIds()).toEqual({})
    })
  })
})
