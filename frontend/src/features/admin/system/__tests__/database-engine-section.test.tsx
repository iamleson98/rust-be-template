import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { EngineStatsOut } from '@/api'
import { DatabaseEngineSection } from '../database-engine-section'

const ENGINE: EngineStatsOut = {
  version: '2026-03-13 12:48:26 07d118050d7bbc4233db20ce9a7256ce2e779e9bd81b6aec0f20e15a8c20aeca',
  sqliteVersion: '3.51.3',
  memory: { heapMb: 12.345, heapPeakMb: 20 },
}

describe('DatabaseEngineSection', () => {
  it('shows the SQLite version, build id and heap figures the server reports', () => {
    render(<DatabaseEngineSection engine={ENGINE} />)
    expect(screen.getByText('SQLite 3.51.3')).toBeVisible()
    expect(screen.getByText(ENGINE.version)).toBeVisible()
    expect(screen.getByText('12.35 MB')).toBeVisible()
    expect(screen.getByText('20.00 MB')).toBeVisible()
  })

  it('leaves out what the server did not report instead of showing 0', () => {
    render(
      <DatabaseEngineSection
        engine={{ version: '', sqliteVersion: '', memory: { heapMb: Number.NaN, heapPeakMb: -1 } }}
      />,
    )
    expect(screen.queryByTestId('engine-build-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('engine-memory-card')).not.toBeInTheDocument()
    expect(screen.queryByText(/SQLite/)).not.toBeInTheDocument()
    expect(screen.queryByText(/0\.00 MB/)).not.toBeInTheDocument()
  })

  it('shows only the figure that is known', () => {
    render(
      <DatabaseEngineSection
        engine={{ ...ENGINE, memory: { heapMb: Number.NaN, heapPeakMb: 5 } }}
      />,
    )
    expect(screen.getByText('5.00 MB')).toBeVisible()
    expect(screen.queryByText('heap hiện tại')).not.toBeInTheDocument()
  })
})
