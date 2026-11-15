import { formDataBodySerializer } from './generated/client'
import { client } from './generated/client.gen'
import type { UploadBrandLogoErrors, UploadBrandLogoResponses } from './generated/types.gen'

/**
 * Upload a brand logo (`POST /api/uploads/brand-logo`). The server re-encodes
 * it to WebP before storing it; resolves to the public URL to save on the
 * brand. Sent by hand because the contract types a multipart body as a byte
 * array, which the generated function would force a cast on; the response is
 * the contract's `BrandLogoUploadResponse`.
 */
export async function uploadBrandLogo(file: File): Promise<string> {
  const { data } = await client.post<UploadBrandLogoResponses, UploadBrandLogoErrors, true>({
    ...formDataBodySerializer,
    url: '/api/uploads/brand-logo',
    body: { file },
    headers: { 'Content-Type': null },
    throwOnError: true,
  })
  return data.url
}
