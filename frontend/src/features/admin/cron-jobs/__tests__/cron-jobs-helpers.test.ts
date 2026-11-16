import { describe, expect, it } from 'vitest'

import {
  dateTimeLabel,
  durationLabel,
  elapsedLabel,
  humanizeDuration,
  isActiveRun,
  jobDescription,
  jobHeading,
  jobTypeLabel,
  progressMessage,
  runDetailText,
  runStatusClass,
  runStatusLabel,
  scheduleIntervalLabel,
  timeLabel,
} from '../helpers'

describe('cron-jobs helpers', () => {
  describe('runStatusLabel / runStatusClass', () => {
    it('maps every known status to a Vietnamese label', () => {
      expect(runStatusLabel('queued')).toBe('Đang chờ')
      expect(runStatusLabel('running')).toBe('Đang chạy')
      expect(runStatusLabel('succeeded')).toBe('Thành công')
      expect(runStatusLabel('failed')).toBe('Thất bại')
      expect(runStatusLabel('cancelled')).toBe('Đã dừng')
    })

    it('passes unknown statuses through', () => {
      expect(runStatusLabel('weird')).toBe('weird')
      expect(runStatusClass('weird')).toContain('bg-slate-100')
    })

    it('gives each status a distinct colour class', () => {
      const classes = ['queued', 'running', 'succeeded', 'failed', 'cancelled'].map(runStatusClass)
      expect(new Set(classes).size).toBe(5)
    })

    it('includes dark-mode variants', () => {
      for (const status of ['queued', 'running', 'succeeded', 'failed', 'cancelled']) {
        expect(runStatusClass(status)).toContain('dark:')
      }
    })
  })

  describe('schedule labels', () => {
    it('labels common intervals in Vietnamese', () => {
      expect(scheduleIntervalLabel(1)).toBe('Hàng ngày')
      expect(scheduleIntervalLabel(7)).toBe('Hàng tuần')
      expect(scheduleIntervalLabel(14)).toBe('Hai tuần một lần')
      expect(scheduleIntervalLabel(30)).toBe('Hàng tháng')
    })

    it('falls back to "Mỗi N ngày"', () => {
      expect(scheduleIntervalLabel(10)).toBe('Mỗi 10 ngày')
    })

    it('pads hour/minute to two digits', () => {
      expect(timeLabel(2, 0)).toBe('02:00')
      expect(timeLabel(23, 59)).toBe('23:59')
    })
  })

  describe('durations', () => {
    it('humanizes ms spans', () => {
      expect(humanizeDuration(400)).toBe('< 1 giây')
      expect(humanizeDuration(45_000)).toBe('45 giây')
      expect(humanizeDuration(5 * 60_000)).toBe('5 phút')
      expect(humanizeDuration(83 * 60_000)).toBe('1 giờ 23 phút')
      expect(humanizeDuration(2 * 3_600_000)).toBe('2 giờ')
    })

    it('computes finished-run durations from ISO strings', () => {
      const start = '2026-09-01T18:00:00Z'
      const end = '2026-09-01T19:23:00Z'
      expect(durationLabel(start, end)).toBe('1 giờ 23 phút')
    })

    it('rejects bad or inverted durations', () => {
      expect(durationLabel(null, '2026-09-01T18:00:00Z')).toBeNull()
      expect(durationLabel('2026-09-01T18:00:00Z', null)).toBeNull()
      expect(durationLabel('not a date', '2026-09-01T18:00:00Z')).toBeNull()
      // finished before started → null, not negative
      expect(durationLabel('2026-09-01T19:00:00Z', '2026-09-01T18:00:00Z')).toBeNull()
    })

    it('computes live elapsed from a start time', () => {
      const now = Date.parse('2026-09-01T18:05:00Z')
      expect(elapsedLabel('2026-09-01T18:00:00Z', now)).toBe('5 phút')
      expect(elapsedLabel(null, now)).toBeNull()
    })
  })

  describe('dateTimeLabel', () => {
    it('formats short date-times', () => {
      // Local timezone rendering — just assert shape, not exact hour.
      const label = dateTimeLabel('2026-09-02T02:00:00Z')
      expect(label).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/)
    })

    it('renders an em dash for missing values', () => {
      expect(dateTimeLabel(null)).toBe('—')
      expect(dateTimeLabel('garbage')).toBe('—')
    })
  })

  describe('progressMessage', () => {
    it('prefers message over phase', () => {
      expect(progressMessage({ phase: 'indexing', message: '512 MiB downloaded' })).toBe(
        '512 MiB downloaded',
      )
      expect(progressMessage({ phase: 'publishing' })).toBe('publishing')
    })

    it('ignores non-object detail', () => {
      expect(progressMessage(null)).toBeNull()
      expect(progressMessage('downloading')).toBeNull()
      expect(progressMessage({})).toBeNull()
    })
  })

  describe('runDetailText (places.build facts)', () => {
    const published = {
      phase: 'done',
      message: 'published generation 20261116T033000Z (326729 places)',
      outcome: 'published',
      generation: '20261116T033000Z',
      places: 326729,
      dropped: 12,
      extractMd5: '0123456789abcdef0123456789abcdef',
      durationSecs: 754,
      profile: 'all',
    }

    it('lists what a published build reported, in Vietnamese', () => {
      const text = runDetailText('places.build', published)
      expect(text).toBe(
        [
          'Đã phát hành thế hệ mới',
          'thế hệ 20261116T033000Z',
          `${(326729).toLocaleString('vi-VN')} địa điểm`,
          '12 bị loại (ngoài các tỉnh phục vụ)',
          'hồ sơ all',
          'md5 bản trích 0123456789abcdef0123456789abcdef',
        ].join(' · '),
      )
    })

    it('says an unchanged extract changed nothing and shows only the reported facts', () => {
      const text = runDetailText('places.build', {
        outcome: 'unchanged',
        generation: '20261109T033000Z',
        places: 326000,
        extractMd5: 'abc',
      })
      expect(text).toContain('Không đổi: md5 bản trích khớp với thế hệ đang chạy')
      expect(text).toContain('thế hệ 20261109T033000Z')
      expect(text).toContain('md5 bản trích abc')
      expect(text).not.toContain('bị loại')
      expect(text).not.toContain('hồ sơ')
    })

    it('shows nothing invented for a bare outcome', () => {
      expect(runDetailText('places.build', { outcome: 'published' })).toBe(
        'Đã phát hành thế hệ mới',
      )
      expect(runDetailText('places.build', { outcome: 'published', places: Number.NaN })).toBe(
        'Đã phát hành thế hệ mới',
      )
    })

    it('shows a failure through the run error, not the detail', () => {
      expect(runDetailText('places.build', { outcome: 'failed', reason: 'boom' })).toBeNull()
    })

    it('localises the running phase and ignores unknown or empty detail', () => {
      expect(runDetailText('places.build', { phase: 'running', message: 'building' })).toBe(
        'Đang dựng chỉ mục địa điểm…',
      )
      expect(runDetailText('places.build', null)).toBeNull()
      expect(runDetailText('places.build', {})).toBeNull()
    })

    it('leaves other jobs to their progress message', () => {
      expect(runDetailText('coupons.expire', { message: 'expired 3 unused coupons' })).toBe(
        'expired 3 unused coupons',
      )
    })
  })

  describe('job status helpers', () => {
    it('treats queued/running as active', () => {
      expect(isActiveRun('queued')).toBe(true)
      expect(isActiveRun('running')).toBe(true)
      expect(isActiveRun('succeeded')).toBe(false)
      expect(isActiveRun('failed')).toBe(false)
      // Cancelled is terminal — the job can be triggered again.
      expect(isActiveRun('cancelled')).toBe(false)
    })

    it('labels and describes the place-index build in Vietnamese', () => {
      expect(jobTypeLabel('places.build')).toBe('Dựng lại chỉ mục tìm kiếm địa điểm')
      expect(jobDescription({ jobType: 'places.build', description: 'catalog text' })).toContain(
        'OpenStreetMap',
      )
      expect(jobDescription({ jobType: 'x.y', description: 'catalog text' })).toBe('catalog text')
      expect(jobDescription({ jobType: 'x.y' })).toBeNull()
    })

    it('labels the coupon-expiry job in Vietnamese', () => {
      expect(jobTypeLabel('coupons.expire')).toBe('Hết hạn mã giảm giá chưa dùng')
      expect(jobTypeLabel('other.job')).toBe('other.job')
    })

    it('prefers the localised label, falls back to the catalog description', () => {
      // Known job → Vietnamese label wins over the API description.
      expect(jobHeading({ jobType: 'coupons.expire', description: 'catalog text' })).toBe(
        'Hết hạn mã giảm giá chưa dùng',
      )
      // Unknown job → the catalog description from the API.
      expect(jobHeading({ jobType: 'x.y', description: 'catalog text' })).toBe('catalog text')
      // Unknown job without a description → the raw job type.
      expect(jobHeading({ jobType: 'x.y', description: null })).toBe('x.y')
      expect(jobHeading({ jobType: 'x.y' })).toBe('x.y')
    })
  })
})
