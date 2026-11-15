import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { PictureLightbox } from '../picture-lightbox'
import type { Slide } from '../picture-slider'

const slides: Slide[] = [
  { id: 'a', src: '/a.webp', alt: 'Ảnh A' },
  { id: 'b', src: '/b.webp', alt: 'Ảnh B' },
]

function Harness({ onClose = vi.fn(), start = 1 }: { onClose?: () => void; start?: number }) {
  const [index, setIndex] = useState(start)
  return (
    <PictureLightbox
      slides={slides}
      index={index}
      onIndexChange={setIndex}
      onClose={onClose}
      title="Sài Gòn - Đà Lạt"
    />
  )
}

describe('PictureLightbox', () => {
  it('opens on the picture that was clicked, titled for the trip', async () => {
    render(<Harness />)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAccessibleName('Sài Gòn - Đà Lạt')
    expect(screen.getByRole('img', { name: 'Ảnh B' })).toHaveAttribute('src', '/b.webp')
  })

  it('steps and wraps with the buttons, keeping its picture counter in step', async () => {
    render(<Harness start={0} />)
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: 'Ảnh sau' }))
    expect(screen.getByRole('img', { name: 'Ảnh B' })).toBeVisible()
    expect(screen.getByText('2/2')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Ảnh sau' }))
    expect(screen.getByRole('img', { name: 'Ảnh A' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Ảnh trước' }))
    expect(screen.getByRole('img', { name: 'Ảnh B' })).toBeVisible()
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
