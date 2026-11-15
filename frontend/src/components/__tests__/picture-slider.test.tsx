import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { PictureSlider, type Slide } from '../picture-slider'

const slides: Slide[] = [
  { id: 'a', src: '/a.webp', thumbSrc: '/a-thumb.webp', alt: 'Ảnh A' },
  { id: 'b', src: '/b.webp', alt: 'Ảnh B' },
  { id: 'c', src: '/c.webp', alt: 'Ảnh C' },
]

/** A caller that owns the index, as the trip dialog and the lightbox do. */
function Harness({
  start = 0,
  items = slides,
  globalKeys,
}: {
  start?: number
  items?: Slide[]
  globalKeys?: boolean
}) {
  const [index, setIndex] = useState(start)
  return (
    <PictureSlider slides={items} index={index} onIndexChange={setIndex} globalKeys={globalKeys} />
  )
}

const stage = () => screen.getByRole('img', { name: /Ảnh/ })
const next = () => screen.getByRole('button', { name: 'Ảnh sau' })
const prev = () => screen.getByRole('button', { name: 'Ảnh trước' })

describe('PictureSlider', () => {
  it('shows the picture at the given index and its position', () => {
    render(<Harness start={1} />)
    expect(stage()).toHaveAttribute('src', '/b.webp')
    expect(screen.getByText('2/3')).toBeVisible()
  })

  it('steps forward and back, wrapping at both ends', async () => {
    render(<Harness />)
    await userEvent.click(prev())
    expect(stage()).toHaveAttribute('src', '/c.webp')
    await userEvent.click(next())
    expect(stage()).toHaveAttribute('src', '/a.webp')
    await userEvent.click(next())
    expect(stage()).toHaveAttribute('src', '/b.webp')
  })

  it('jumps to a thumbnail, which uses the small version when there is one', async () => {
    const { container } = render(<Harness />)
    const thumbs = container.querySelectorAll('li img')
    expect(thumbs[0]).toHaveAttribute('src', '/a-thumb.webp')
    expect(thumbs[1]).toHaveAttribute('src', '/b.webp')
    await userEvent.click(screen.getByRole('button', { name: 'Chuyển đến ảnh 3' }))
    expect(stage()).toHaveAttribute('src', '/c.webp')
    expect(screen.getByRole('button', { name: 'Chuyển đến ảnh 3' })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('answers the arrow keys while it has focus', () => {
    render(<Harness />)
    const group = screen.getByRole('group')
    fireEvent.keyDown(group, { key: 'ArrowRight' })
    expect(stage()).toHaveAttribute('src', '/b.webp')
    fireEvent.keyDown(group, { key: 'ArrowLeft' })
    fireEvent.keyDown(group, { key: 'ArrowLeft' })
    expect(stage()).toHaveAttribute('src', '/c.webp')
  })

  it('ignores the arrow keys outside itself unless asked to listen everywhere', () => {
    const { unmount } = render(<Harness />)
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    expect(stage()).toHaveAttribute('src', '/a.webp')
    unmount()

    render(<Harness globalKeys />)
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    expect(stage()).toHaveAttribute('src', '/b.webp')
  })

  it('still hears the arrow keys when a dialog around it swallows key events', () => {
    const swallow = (e: Event) => e.stopPropagation()
    const dialog = document.createElement('div')
    dialog.addEventListener('keydown', swallow)
    document.body.append(dialog)
    try {
      render(<Harness globalKeys />, { container: dialog })
      fireEvent.keyDown(screen.getByRole('group'), { key: 'ArrowRight' })
      expect(stage()).toHaveAttribute('src', '/b.webp')
    } finally {
      dialog.remove()
    }
  })

  it('leaves the arrow keys to a text field when listening everywhere', () => {
    render(
      <>
        <input aria-label="ghi chú" />
        <Harness globalKeys />
      </>,
    )
    fireEvent.keyDown(screen.getByLabelText('ghi chú'), { key: 'ArrowRight' })
    expect(stage()).toHaveAttribute('src', '/a.webp')
  })

  it('stops listening to the page once it is gone', () => {
    const onIndexChange = vi.fn()
    const { unmount } = render(
      <PictureSlider slides={slides} index={0} onIndexChange={onIndexChange} globalKeys />,
    )
    unmount()
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    expect(onIndexChange).not.toHaveBeenCalled()
  })

  it('turns a swipe into a step, but not a tap or a short drag', () => {
    render(<Harness start={1} />)
    const surface = stage().parentElement as HTMLElement
    const swipe = (from: number, to: number) => {
      fireEvent.pointerDown(surface, { clientX: from })
      fireEvent.pointerUp(surface, { clientX: to })
    }
    swipe(100, 90) // a short drag
    expect(stage()).toHaveAttribute('src', '/b.webp')
    swipe(200, 100) // finger moves left: the next picture
    expect(stage()).toHaveAttribute('src', '/c.webp')
    swipe(100, 200) // finger moves right: the previous one
    expect(stage()).toHaveAttribute('src', '/b.webp')
  })

  it('does not start a swipe on the step buttons it would also press', () => {
    render(<Harness />)
    const surface = stage().parentElement as HTMLElement
    fireEvent.pointerDown(next(), { clientX: 300 })
    fireEvent.pointerUp(surface, { clientX: 100 })
    expect(stage()).toHaveAttribute('src', '/a.webp')
  })

  it('keeps a lone picture still: no buttons, no thumbnails, no arrow keys', () => {
    const onIndexChange = vi.fn()
    render(
      <PictureSlider slides={[slides[0]]} index={0} onIndexChange={onIndexChange} globalKeys />,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('1/1')).toBeVisible()
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    expect(onIndexChange).not.toHaveBeenCalled()
  })

  it('renders nothing without pictures', () => {
    const { container } = render(<Harness items={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('clamps an index that points past the pictures', () => {
    render(<Harness start={9} />)
    expect(stage()).toHaveAttribute('src', '/c.webp')
    expect(screen.getByText('3/3')).toBeVisible()
  })

  it('loads the neighbours of the current picture ahead of the step', () => {
    const loaded: string[] = []
    const RealImage = window.Image
    vi.stubGlobal(
      'Image',
      class {
        set src(value: string) {
          loaded.push(value)
        }
      },
    )
    try {
      render(<Harness start={0} />)
      expect(loaded.sort()).toEqual(['/b.webp', '/c.webp'])
    } finally {
      vi.stubGlobal('Image', RealImage)
    }
  })
})
