import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { client } from '@/api/generated/client.gen'
import { useBrandLogo } from '../brand-logo-field'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }))

const file = new File(['logo'], 'logo.png', { type: 'image/png' })

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:logo')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => vi.restoreAllMocks())

describe('useBrandLogo.commit', () => {
  it('uploads the picked file as multipart form data and resolves to its public URL', async () => {
    const post = vi.spyOn(client, 'post').mockResolvedValue({
      data: { key: 'brands/logos/ab.webp', url: '/api/media/brands/logos/ab.webp' },
    } as never)
    const { result } = renderHook(() => useBrandLogo(null, true))

    act(() => result.current.pick(file))
    const url = await act(() => result.current.commit())

    expect(url).toBe('/api/media/brands/logos/ab.webp')
    expect(post).toHaveBeenCalledTimes(1)
    const options = post.mock.calls[0][0] as unknown as {
      url: string
      body: { file: File }
      headers: Record<string, string | null>
      bodySerializer: unknown
    }
    expect(options.url).toBe('/api/uploads/brand-logo')
    expect(options.body.file).toBe(file)
    // Multipart: the serializer builds the form, the browser picks the boundary.
    expect(typeof options.bodySerializer).toBe('function')
    expect(options.headers['Content-Type']).toBeNull()
  })

  it('leaves the logo alone without a pick, and clears it once removed', async () => {
    const { result } = renderHook(() => useBrandLogo('/api/media/brands/logos/ab.webp', true))
    expect(await act(() => result.current.commit())).toBeUndefined()

    act(() => result.current.remove())
    expect(await act(() => result.current.commit())).toBeNull()
  })

  it('rejects when the server refuses the file', async () => {
    vi.spyOn(client, 'post').mockRejectedValue(new Error('413'))
    const { result } = renderHook(() => useBrandLogo(null, true))

    act(() => result.current.pick(file))
    await expect(act(() => result.current.commit())).rejects.toThrow('413')
  })
})
