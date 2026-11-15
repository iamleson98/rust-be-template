import { afterEach, describe, expect, it, vi } from 'vitest'
import { client } from '../generated/client.gen'
import { uploadBrandLogo } from '../uploads'

afterEach(() => vi.restoreAllMocks())

describe('uploadBrandLogo', () => {
  const file = new File(['logo'], 'logo.png', { type: 'image/png' })

  it('posts the file as multipart form data and resolves to its public URL', async () => {
    const post = vi.spyOn(client, 'post').mockResolvedValue({
      data: { key: 'brands/logos/ab.webp', url: '/api/media/ab.webp' },
    } as never)

    expect(await uploadBrandLogo(file)).toBe('/api/media/ab.webp')

    expect(post).toHaveBeenCalledTimes(1)
    const options = post.mock.calls[0][0] as unknown as {
      url: string
      body: { file: File }
      headers: Record<string, string | null>
      throwOnError: boolean
      bodySerializer: unknown
    }
    expect(options.url).toBe('/api/uploads/brand-logo')
    expect(options.body.file).toBe(file)
    // Multipart: the serializer builds the form, the browser picks the boundary.
    expect(typeof options.bodySerializer).toBe('function')
    expect(options.headers['Content-Type']).toBeNull()
    expect(options.throwOnError).toBe(true)
  })

  it('rejects when the server refuses the file', async () => {
    vi.spyOn(client, 'post').mockRejectedValue(new Error('413'))
    await expect(uploadBrandLogo(file)).rejects.toThrow('413')
  })
})
