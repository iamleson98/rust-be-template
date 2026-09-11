import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/queries', () => {
  return {
    useSystemMetrics: vi.fn(),
  }
})

import { useSystemMetrics } from '@/lib/queries'
import type { SystemMetrics } from '@/lib/queries'
import { SystemMetricsSection } from '../system-metrics-section'

const useSystemMetricsMock = useSystemMetrics as unknown as ReturnType<typeof vi.fn>

const METRICS: SystemMetrics = {
  cpuUsagePercent: 12.4,
  perCoreUsagePercent: [10.2, 14.6, 8.9, 15.9],
  logicalCores: 4,
  physicalCores: 2,
  memoryTotalBytes: 16_000_000_000,
  memoryUsedBytes: 8_000_000_000,
  memoryAvailableBytes: 8_000_000_000,
  memoryUsagePercent: 50.0,
  processMemoryBytes: 500_000_000,
  processCpuUsagePercent: 87.3,
  disks: [
    {
      mountPoint: '/',
      fsType: 'ext4',
      totalBytes: 200_000_000_000,
      availableBytes: 100_000_000_000,
      usagePercent: 50.0,
      isRemovable: false,
    },
    {
      mountPoint: '/media/usb',
      fsType: 'vfat',
      totalBytes: 32_000_000_000,
      availableBytes: 16_000_000_000,
      usagePercent: 50.0,
      isRemovable: true,
    },
  ],
  uptimeSecs: 90061,
  osName: 'Ubuntu 24.04',
  kernelVersion: '6.8.0-45-generic',
  hostname: 'vexevn-prod',
  timestamp: '2026-09-07T05:10:39Z',
}

function mockQueryResult(partial: {
  data?: SystemMetrics
  isLoading?: boolean
  isError?: boolean
  isFetching?: boolean
  error?: Error | null
  refetch?: ReturnType<typeof vi.fn>
}) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    ...partial,
  }
}

describe('SystemMetricsSection (pdf-tts server-metrics port)', () => {
  beforeEach(() => {
    useSystemMetricsMock.mockReset()
  })

  it('renders the section header with the live badge and refresh button', () => {
    useSystemMetricsMock.mockReturnValue(
      mockQueryResult({ data: METRICS, isFetching: true }),
    )
    render(<SystemMetricsSection />)

    expect(screen.getByTestId('system-metrics')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /server metrics/i })).toBeInTheDocument()
    expect(screen.getByText('live · 5s')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /refresh/i })).toBeDisabled()
  })

  it('shows a structure-matched skeleton (not a data table) while the first snapshot loads', () => {
    useSystemMetricsMock.mockReturnValue(mockQueryResult({ isLoading: true }))
    render(<SystemMetricsSection />)

    // The skeleton mirrors the loaded card layout…
    expect(screen.getByTestId('system-metrics-skeleton')).toBeInTheDocument()
    // …the header stays visible…
    expect(screen.getByRole('heading', { name: /server metrics/i })).toBeInTheDocument()
    // …and no metric card or table renders before data arrives.
    expect(screen.queryByTestId('metric-cpu-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('metric-memory-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('metric-process-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('metric-disks-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('metric-host-card')).not.toBeInTheDocument()
  })

  it('renders the five metric cards once data arrives', () => {
    useSystemMetricsMock.mockReturnValue(mockQueryResult({ data: METRICS }))
    render(<SystemMetricsSection />)

    // CPU card: overall percent + core count summary.
    expect(screen.getByTestId('metric-cpu-card')).toBeInTheDocument()
    expect(screen.getByText('12.4%')).toBeInTheDocument()
    expect(screen.getByText('4 logical · 2 physical cores')).toBeInTheDocument()
    // Per-core mini-bars are rendered for every core.
    expect(screen.getAllByText('10%').length).toBeGreaterThan(0)

    // Memory card.
    expect(screen.getByTestId('metric-memory-card')).toBeInTheDocument()
    expect(screen.getByText('50.0%')).toBeInTheDocument()
    expect(screen.getByText('8 GB / 16 GB')).toBeInTheDocument()

    // Process card: RSS + uptime.
    expect(screen.getByTestId('metric-process-card')).toBeInTheDocument()
    expect(screen.getByText('500 MB')).toBeInTheDocument()
    expect(screen.getByText('1d 1h')).toBeInTheDocument()

    // Disks card: both volumes + the removable badge.
    expect(screen.getByTestId('metric-disks-card')).toBeInTheDocument()
    expect(screen.getByText('/')).toBeInTheDocument()
    expect(screen.getByText('/media/usb')).toBeInTheDocument()
    expect(screen.getByText('ext4')).toBeInTheDocument()
    expect(screen.getByText('removable')).toBeInTheDocument()

    // Host card.
    expect(screen.getByTestId('metric-host-card')).toBeInTheDocument()
    expect(screen.getByText('vexevn-prod')).toBeInTheDocument()
    expect(screen.getByText('Ubuntu 24.04')).toBeInTheDocument()
    expect(screen.getByText('6.8.0-45-generic')).toBeInTheDocument()
  })

  it('renders the backend error message in a red alert card', () => {
    useSystemMetricsMock.mockReturnValue(
      mockQueryResult({ isError: true, error: new Error('forbidden: missing permission') }),
    )
    render(<SystemMetricsSection />)

    expect(screen.getByTestId('system-metrics-error')).toBeInTheDocument()
    expect(screen.getByText('Failed to load server metrics')).toBeInTheDocument()
    expect(screen.getByText('forbidden: missing permission')).toBeInTheDocument()
    // No cards, no skeleton — just the error state.
    expect(screen.queryByTestId('metric-cpu-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('system-metrics-skeleton')).not.toBeInTheDocument()
  })

  it('requests a refetch when Refresh is clicked', async () => {
    const refetch = vi.fn()
    useSystemMetricsMock.mockReturnValue(
      mockQueryResult({ data: METRICS, refetch }),
    )
    render(<SystemMetricsSection />)

    await screen.getByRole('button', { name: /refresh/i }).click()
    expect(refetch).toHaveBeenCalledTimes(1)
  })
})
