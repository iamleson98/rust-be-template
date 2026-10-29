/**
 * Re-encoding uploads with the Cloudflare Images binding (`IMAGES`): Workers
 * have no image codec of their own. Everything an admin uploads is decoded
 * (which rejects corrupt files and polyglots), scaled down and written back
 * out as WebP, so R2 never holds an original and no EXIF (GPS included).
 */
import { ApiError } from "@/lib/auth/rbac";
import { badRequest } from "@/lib/services/http-errors";

export interface Encoded {
  bytes: Uint8Array;
  width: number;
  height: number;
}

export const unavailable = () =>
  new ApiError(503, "unavailable", "image processing is not available; try again later");

/** The Images binding's verdict on `data`: dimensions of a decodable raster, else a 400. */
export async function decode(images: ImagesBinding, data: Uint8Array) {
  const stream = new Blob([data as BlobPart]).stream();
  let info;
  try {
    info = await images.info(stream);
  } catch (e) {
    throw badRequest(`image failed to decode (corrupt or unsupported): ${String(e)}`);
  }
  if (!("width" in info))
    throw badRequest("image failed to decode (corrupt or unsupported): not a raster image");
  return { width: info.width, height: info.height };
}

/** `data` scaled down to fit `longEdge` px (never enlarged) and re-encoded as WebP. */
export async function toWebp(
  images: ImagesBinding,
  data: Uint8Array,
  longEdge: number,
  quality: number,
): Promise<Encoded> {
  const out = await images
    .input(new Blob([data as BlobPart]).stream())
    .transform({ width: longEdge, height: longEdge, fit: "scale-down" })
    .output({ format: "image/webp", quality });
  const bytes = new Uint8Array(await out.response().arrayBuffer());
  return { bytes, ...(await decode(images, bytes)) };
}
