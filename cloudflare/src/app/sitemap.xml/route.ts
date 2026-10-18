import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";

const BASE = "https://datxevui.com";

/** `GET /sitemap.xml` — static shell + one URL per brand slug. */
export async function GET() {
  try {
    const brands = await rawAll<{ slug: string }>(
      sql`SELECT slug FROM brand WHERE status = 'active' ORDER BY slug`,
    );
    const now = new Date().toISOString().slice(0, 10);
    const urls = [
      { loc: `${BASE}/`, changefreq: "daily", priority: "1.0" },
      { loc: `${BASE}/search`, changefreq: "daily", priority: "0.9" },
      { loc: `${BASE}/compare`, changefreq: "weekly", priority: "0.6" },
      { loc: `${BASE}/login`, changefreq: "monthly", priority: "0.5" },
      { loc: `${BASE}/privacy`, changefreq: "yearly", priority: "0.3" },
      { loc: `${BASE}/terms`, changefreq: "yearly", priority: "0.3" },
      ...brands.map((b) => ({
        loc: `${BASE}/brands/${b.slug}`,
        changefreq: "weekly",
        priority: "0.7",
      })),
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url><loc>${u.loc}</loc><lastmod>${now}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`,
  )
  .join("\n")}
</urlset>`;
    return new Response(xml, {
      headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
    });
  } catch {
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`,
      { headers: { "Content-Type": "application/xml; charset=utf-8" } },
    );
  }
}
