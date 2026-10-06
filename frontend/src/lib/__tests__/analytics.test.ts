/**
 * Tests for the analytics module — trackPageView.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { trackPageView } from '@/lib/analytics'

describe('analytics', () => {
  beforeEach(() => {
    // Reset window.gtag between tests
    window.gtag = undefined
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
})
