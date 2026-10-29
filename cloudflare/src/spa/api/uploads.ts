import { formDataBodySerializer } from "./generated/client";
import { client } from "./generated/client.gen";

/**
 * Upload a brand logo (`POST /api/uploads/brand-logo`, outside the OpenAPI
 * contract). The server re-encodes it to WebP before storing it; resolves to
 * the public URL to save on the brand.
 */
export async function uploadBrandLogo(file: File): Promise<string> {
  const { data } = await client.post<{ 201: { key: string; url: string } }, unknown, true>({
    ...formDataBodySerializer,
    url: "/api/uploads/brand-logo",
    body: { file },
    headers: { "Content-Type": null },
    throwOnError: true,
  });
  return data.url;
}
