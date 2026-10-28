import { getEnv } from "@/lib/db/client";
import { publicBaseUrl, robotsTxt } from "@/lib/robots";

/** `GET /robots.txt` — generated, so the sitemap pointer follows the configured public origin. */
export async function GET() {
  const base = publicBaseUrl((await getEnv()).PAYMENT_PUBLIC_BASE_URL);
  return new Response(robotsTxt(base), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
