/**
 * Tests for the TimePicker component (shadcn docs pattern: a styled
 * native `<input type="time">`).
 */
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

import { TimePicker } from '@/components/ui/time-picker'

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
  it('renders a native time input (docs pattern)', () => {
    render(<TimePicker value="08:30" onChange={vi.fn()} aria-label="Giờ" />)
    const input = screen.getByLabelText('Giờ') as HTMLInputElement
    expect(input.type).toBe('time')
    expect(input.value).toBe('08:30')
    // the docs' indicator-hiding classes must stay applied
    expect(input.className).toContain('appearance-none')
  })

  it('normalizes stored values to HH:MM on the way in', () => {
    render(<TimePicker value="8:5" onChange={vi.fn()} aria-label="Giờ" />)
    expect((screen.getByLabelText('Giờ') as HTMLInputElement).value).toBe('08:05')
  })

  it('drops seconds from HH:MM:SS values', () => {
    render(<TimePicker value="10:30:00" onChange={vi.fn()} aria-label="Giờ" />)
    expect((screen.getByLabelText('Giờ') as HTMLInputElement).value).toBe('10:30')
  })

  it('treats invalid values as empty', () => {
    render(<TimePicker value="25:99" onChange={vi.fn()} aria-label="Giờ" />)
    expect((screen.getByLabelText('Giờ') as HTMLInputElement).value).toBe('')
  })

  it('emits HH:MM when the user picks a time', () => {
    render(<Harness />)
    const input = screen.getByLabelText('Giờ') as HTMLInputElement
    fireEvent.change(input, { target: { value: '14:05' } })
    expect(screen.getByTestId('mirror').textContent).toBe('14:05')
  })

  it('emits null (not an empty string) when cleared', () => {
    render(<Harness initial="09:00" />)
    const input = screen.getByLabelText('Giờ') as HTMLInputElement
    fireEvent.change(input, { target: { value: '' } })
    expect(screen.getByTestId('mirror').textContent).toBe('null')
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
