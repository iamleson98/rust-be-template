import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { CronJobOut } from '@/api'
import { JobCard } from '../job-card'

const JOB: CronJobOut = {
  jobType: 'places.build',
  description: 'catalog text',
  enabled: true,
  intervalDays: 7,
  atHour: 3,
  atMinute: 30,
  nextRunAt: '2026-11-22T20:30:00Z',
  updatedAt: '2026-11-16T00:00:00Z',
}

function card(job: CronJobOut) {
  const noop = vi.fn()
  return render(
    <JobCard
      job={job}
      onTrigger={noop}
      onCancel={noop}
      onEdit={noop}
      onToggle={noop}
      busy={false}
    />,
  )
}

describe('JobCard for the place-index build', () => {
  it('shows the name, status, duration and what the finished build reported', () => {
    card({
      ...JOB,
      lastRun: {
        id: 'r1',
        jobType: 'places.build',
        status: 'succeeded',
        startedAt: '2026-11-16T20:30:00Z',
        finishedAt: '2026-11-16T20:42:34Z',
        createdAt: '2026-11-16T20:30:00Z',
        detail: {
          outcome: 'published',
          generation: '20261116T204200Z',
          places: 326729,
          extractMd5: 'abc123',
        },
      },
    })
    expect(screen.getByText('Dựng lại chỉ mục tìm kiếm địa điểm')).toBeVisible()
    expect(screen.getByTestId('cron-run-status')).toHaveTextContent('Thành công')
    expect(screen.getByText('12 phút')).toBeVisible()
    const info = screen.getByTestId('cron-progress')
    expect(info).toHaveTextContent('Đã phát hành thế hệ mới')
    expect(info).toHaveTextContent('thế hệ 20261116T204200Z')
    expect(info).toHaveTextContent('md5 bản trích abc123')
    expect(info).not.toHaveTextContent('bị loại')
  })

  it('shows an unchanged run as such', () => {
    card({
      ...JOB,
      lastRun: {
        id: 'r2',
        jobType: 'places.build',
        status: 'succeeded',
        startedAt: '2026-11-16T20:30:00Z',
        finishedAt: '2026-11-16T20:30:02Z',
        createdAt: '2026-11-16T20:30:00Z',
        detail: { outcome: 'unchanged', extractMd5: 'abc123' },
      },
    })
    expect(screen.getByTestId('cron-progress')).toHaveTextContent(
      'Không đổi: md5 bản trích khớp với thế hệ đang chạy',
    )
  })

  it('shows a failed build through its error only', () => {
    card({
      ...JOB,
      lastRun: {
        id: 'r3',
        jobType: 'places.build',
        status: 'failed',
        startedAt: '2026-11-16T20:30:00Z',
        finishedAt: '2026-11-16T20:31:00Z',
        createdAt: '2026-11-16T20:30:00Z',
        error: 'MD5 mismatch',
        detail: { outcome: 'failed', reason: 'MD5 mismatch' },
      },
    })
    expect(screen.getByTestId('cron-run-status')).toHaveTextContent('Thất bại')
    expect(screen.getByText('MD5 mismatch')).toBeVisible()
    expect(screen.queryByTestId('cron-progress')).not.toBeInTheDocument()
  })

  it('shows nothing about facts while the build has not reported any', () => {
    card({
      ...JOB,
      lastRun: {
        id: 'r4',
        jobType: 'places.build',
        status: 'queued',
        createdAt: '2026-11-16T20:30:00Z',
      },
    })
    expect(screen.queryByTestId('cron-progress')).not.toBeInTheDocument()
  })
})
