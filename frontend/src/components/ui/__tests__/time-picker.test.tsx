/**
 * Tests for the custom TimePicker (house-styled trigger + hour/minute
 * columns; no native `<input type="time">`).
 */
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'

import { TimePicker, normalizeTime } from '@/components/ui/time-picker'

/** Controlled wrapper mirroring how the schedule form uses the picker. */
function Harness(props: { initial?: string | null }) {
  const [value, setValue] = useState<string | null>(props.initial ?? null)
  return (
    <div>
      <TimePicker value={value} onChange={setValue} aria-label="Giờ" />
      <output data-testid="mirror">{value ?? 'null'}</output>
    </div>
  )
}

describe('TimePicker', () => {
  it('is not a native time input', () => {
    const { container } = render(<TimePicker value="08:30" onChange={vi.fn()} aria-label="Giờ" />)
    expect(container.querySelector('input[type="time"]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Giờ: 08:30' })).toHaveTextContent('08:30')
  })

  it('normalizes stored values to HH:MM', () => {
    expect(normalizeTime('8:5')).toBe('08:05')
    expect(normalizeTime('10:30:00')).toBe('10:30')
    expect(normalizeTime('25:99')).toBe('')
    expect(normalizeTime(null)).toBe('')
  })

  it('shows the placeholder when the value is invalid', () => {
    render(<TimePicker value="25:99" onChange={vi.fn()} placeholder="--:--" />)
    expect(screen.getByRole('button', { name: /--:--/ })).toBeInTheDocument()
  })

  it('emits HH:MM as the hour then the minute are picked', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Giờ' }))
    fireEvent.click(
      within(screen.getByRole('listbox', { name: 'Giờ' })).getByRole('option', { name: '14' }),
    )
    expect(screen.getByTestId('mirror').textContent).toBe('14:00')
    fireEvent.click(
      within(screen.getByRole('listbox', { name: 'Phút' })).getByRole('option', { name: '35' }),
    )
    expect(screen.getByTestId('mirror').textContent).toBe('14:35')
  })

  it('keeps an off-grid minute selectable', () => {
    render(<Harness initial="07:42" />)
    fireEvent.click(screen.getByRole('button', { name: 'Giờ: 07:42' }))
    expect(
      within(screen.getByRole('listbox', { name: 'Phút' })).getByRole('option', { name: '42' }),
    ).toHaveAttribute('aria-selected', 'true')
  })

  it('clear button emits null', () => {
    render(<Harness initial="09:00" />)
    fireEvent.click(screen.getByRole('button', { name: 'Xoá giờ' }))
    expect(screen.getByTestId('mirror').textContent).toBe('null')
  })

  it('hides the clear button when empty or clearable=false', () => {
    const { rerender } = render(<TimePicker value={null} onChange={vi.fn()} aria-label="Giờ" />)
    expect(screen.queryByRole('button', { name: 'Xoá giờ' })).toBeNull()
    rerender(<TimePicker value="07:15" onChange={vi.fn()} aria-label="Giờ" clearable={false} />)
    expect(screen.queryByRole('button', { name: 'Xoá giờ' })).toBeNull()
  })
})
