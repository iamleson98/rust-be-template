/**
 * The Images binding is not available under workerd, so this stands in for it:
 * it reads a PNG header (or its own "WebP", a RIFF header plus the size it
 * encodes) the way `info()` would, and "re-encodes" by scaling the size down
 * to the requested long edge. The output differs per size, like real WebP.
 */
const WEBP_HEAD = new TextEncoder().encode("RIFF\0\0\0\0WEBP");
async function sizeOf(
  stream: ReadableStream,
): Promise<{ width: number; height: number; salt?: number }> {
  const b = new Uint8Array(await new Response(stream).arrayBuffer());
  const v = new DataView(b.buffer);
  if (b[0] === 0x89 && b.length >= 24 && v.getUint32(16) > 0)
    return { width: v.getUint32(16), height: v.getUint32(20), salt: b[32] };
  if (b[0] === 0x52 && b.length > 12) return JSON.parse(new TextDecoder().decode(b.subarray(12)));
  throw new Error("unsupported");
}
export const fakeImages = {
  info: async (stream: ReadableStream) => ({ format: "image/png", ...(await sizeOf(stream)) }),
  input: (stream: ReadableStream) => {
    let edge = Infinity;
    const chain = {
      transform: (t: { width: number }) => ((edge = t.width), chain),
      output: async () => {
        const { width, height, salt } = await sizeOf(stream);
        const scale = Math.min(1, edge / Math.max(width, height));
        const size = {
          salt,
          width: Math.round(width * scale),
          height: Math.round(height * scale),
        };
        const body = new Uint8Array([
          ...WEBP_HEAD,
          ...new TextEncoder().encode(JSON.stringify(size)),
        ]);
        return { response: () => new Response(body) };
      },
    };
    return chain;
  },
};
