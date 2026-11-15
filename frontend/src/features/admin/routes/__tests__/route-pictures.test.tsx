import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockApi } from '@/test/api'
import { MAX_ROUTE_PICTURES, useRoutePictures } from '../route-pictures'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }))

// The upload goes out as multipart form data, which jsdom's FormData cannot hand to
// Node's Request: the three writes are replaced by recorders; the listing stays real.
const writes = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
  patch: vi.fn(),
}))
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  uploadPictureMutation: () => ({ mutationFn: writes.upload }),
  deletePictureMutation: () => ({ mutationFn: writes.remove }),
  patchPictureMutation: () => ({ mutationFn: writes.patch }),
}))

const picture = (id: string) => ({
  id,
  url: `/media/${id}.webp`,
  thumbUrl: `/media/${id}-t.webp`,
})

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
)

const image = (name: string, type = 'image/webp', size = 10) => {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

let listing: ReturnType<typeof picture>[]
beforeEach(() => {
  vi.clearAllMocks()
  listing = [picture('p1'), picture('p2'), picture('p3')]
  mockApi({ 'GET /api/admin/routes/r-1/pictures': () => ({ items: listing }) })
  let n = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:preview-${++n}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  writes.upload.mockImplementation(async () => ({ picture: picture('new-1') }))
  writes.remove.mockResolvedValue({})
  writes.patch.mockResolvedValue({})
})

const open = async (routeId: string | null = 'r-1') => {
  const hook = renderHook(() => useRoutePictures(routeId ?? undefined, true), { wrapper })
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  return hook
}

describe('useRoutePictures', () => {
  it('starts from the pictures the server holds, thumbnails first', async () => {
    const { result } = await open()
    expect(result.current.items).toEqual([
      { kind: 'saved', id: 'p1', src: '/media/p1-t.webp', full: '/media/p1.webp' },
      { kind: 'saved', id: 'p2', src: '/media/p2-t.webp', full: '/media/p2.webp' },
      { kind: 'saved', id: 'p3', src: '/media/p3-t.webp', full: '/media/p3.webp' },
    ])
  })

  it('starts a new route empty', async () => {
    const { result } = await open(null)
    expect(result.current.items).toEqual([])
  })

  it('reorders, and leaves the ends where they are', async () => {
    const { result } = await open()
    act(() => result.current.shift(0, 1))
    expect(result.current.items.map((i) => (i.kind === 'saved' ? i.id : ''))).toEqual([
      'p2',
      'p1',
      'p3',
    ])
    act(() => result.current.shift(0, -1))
    act(() => result.current.shift(2, 1))
    expect(result.current.items.map((i) => (i.kind === 'saved' ? i.id : ''))).toEqual([
      'p2',
      'p1',
      'p3',
    ])
  })

  it('refuses files that are not images the server takes, or too large', async () => {
    const { result } = await open(null)
    act(() =>
      result.current.add([
        image('a.gif', 'image/gif'),
        image('huge.png', 'image/png', 10 * 1024 * 1024 + 1),
        image('ok.jpg', 'image/jpeg'),
      ]),
    )
    expect(result.current.items.map((i) => (i.kind === 'new' ? i.file.name : ''))).toEqual([
      'ok.jpg',
    ])
    expect(toastError).toHaveBeenCalledTimes(2)
  })

  it(`stops at ${MAX_ROUTE_PICTURES} pictures`, async () => {
    const { result } = await open(null)
    act(() =>
      result.current.add(
        Array.from({ length: MAX_ROUTE_PICTURES + 2 }, (_, i) => image(`${i}.webp`)),
      ),
    )
    expect(result.current.items).toHaveLength(MAX_ROUTE_PICTURES)
    expect(toastError).toHaveBeenCalledTimes(1)
  })

  it('frees the preview of a picture removed before saving', async () => {
    const { result } = await open(null)
    act(() => result.current.add([image('a.webp')]))
    act(() => result.current.remove(0))
    expect(result.current.items).toEqual([])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1')
  })

  it('sends nothing when saved without edits', async () => {
    const { result } = await open()
    let failed = -1
    await act(async () => {
      failed = await result.current.commit('r-1')
    })
    expect(failed).toBe(0)
    expect(writes.upload).not.toHaveBeenCalled()
    expect(writes.remove).not.toHaveBeenCalled()
    expect(writes.patch).not.toHaveBeenCalled()
  })

  it('deletes what was removed and moves only what has to move', async () => {
    const { result } = await open()
    act(() => result.current.remove(1)) // p2 goes
    act(() => result.current.shift(1, -1)) // p3 before p1
    // The server's state after the delete.
    writes.remove.mockImplementation(async () => {
      listing = listing.filter((p) => p.id !== 'p2')
      return {}
    })
    let failed = -1
    await act(async () => {
      failed = await result.current.commit('r-1')
    })
    expect(failed).toBe(0)
    expect(writes.remove).toHaveBeenCalledTimes(1)
    expect(writes.remove.mock.calls[0][0]).toMatchObject({ path: { id: 'r-1', pictureId: 'p2' } })
    // p3 to the front is the only move: p1 follows by itself.
    expect(writes.patch).toHaveBeenCalledTimes(1)
    expect(writes.patch.mock.calls[0][0]).toMatchObject({
      path: { id: 'r-1', pictureId: 'p3' },
      body: { sortOrder: 0 },
    })
  })

  it('uploads new files one at a time and puts them where the admin placed them', async () => {
    const { result } = await open()
    act(() => result.current.add([image('fresh.webp')]))
    act(() => result.current.shift(3, -1))
    act(() => result.current.shift(2, -1))
    act(() => result.current.shift(1, -1)) // [fresh, p1, p2, p3]
    writes.upload.mockImplementation(async () => {
      listing = [...listing, picture('new-1')]
      return { picture: picture('new-1') }
    })
    let failed = -1
    await act(async () => {
      failed = await result.current.commit('r-1')
    })
    expect(failed).toBe(0)
    expect(writes.upload).toHaveBeenCalledTimes(1)
    expect(writes.upload.mock.calls[0][0]).toMatchObject({ path: { id: 'r-1' } })
    expect(writes.patch.mock.calls[0][0]).toMatchObject({
      path: { id: 'r-1', pictureId: 'new-1' },
      body: { sortOrder: 0 },
    })
    expect(result.current.progress).toBeNull()
  })

  it('counts the steps that failed instead of throwing', async () => {
    const { result } = await open()
    act(() => result.current.remove(0))
    act(() => result.current.add([image('fresh.webp')]))
    writes.remove.mockRejectedValue(new Error('gone'))
    writes.upload.mockRejectedValue(new Error('too big'))
    let failed = -1
    await act(async () => {
      failed = await result.current.commit('r-1')
    })
    expect(failed).toBe(2)
  })

  it('drops the edits of a dialog that was closed', async () => {
    const hook = renderHook(({ isOpen }) => useRoutePictures('r-1', isOpen), {
      wrapper,
      initialProps: { isOpen: true },
    })
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    act(() => hook.result.current.remove(0))
    expect(hook.result.current.items).toHaveLength(2)
    hook.rerender({ isOpen: false })
    expect(hook.result.current.items).toEqual([])
    hook.rerender({ isOpen: true })
    await waitFor(() => expect(hook.result.current.items).toHaveLength(3))
  })
})
