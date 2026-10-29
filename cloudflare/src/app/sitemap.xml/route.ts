import { getDb } from "@/lib/db/client";
import { asc, eq } from "drizzle-orm";
import { brands, routes } from "@/lib/db/schema";
import { VIETNAMESE_CITIES } from "@/lib/cities";
import { pageSeo, SITE_URL } from "@spa/lib/seo";

const BASE = SITE_URL;
const cityName = new Map(VIETNAMESE_CITIES.map((c) => [c.id, c.name]));

/** The canonical URL of a corridor's search page (as the page's own head says). */
const corridorUrl = (from: string, to: string) =>
  pageSeo("/search", new URLSearchParams({ from, to }), (k) => k)!.canonical!;

/** `&` in a query string must be escaped inside XML. */
const xmlEscape = (s: string) => s.replaceAll("&", "&amp;");

/**
 * Rendered per request (and cached for an hour by the header below): a
 * build-time prerender would read the empty build database and list no brands.
 */
export const dynamic = "force-dynamic";

/**
 * `GET /sitemap.xml` — the indexable pages: the static ones, one per active
 * brand, and one search page per corridor some active route serves
 * ("vé xe Hà Nội đi Đà Nẵng").
 */
export async function GET() {
  try {
    const db = await getDb();
    const brandRows = await db
      .select({ slug: brands.slug })
      .from(brands)
      .where(eq(brands.status, "active"))
      .orderBy(asc(brands.slug));
    const corridors = await db
      .selectDistinct({ from: routes.startLocationId, to: routes.endLocationId })
      .from(routes)
      .where(eq(routes.status, "active"));
    const now = new Date().toISOString().slice(0, 10);
    const urls = [
      { loc: `${BASE}/`, changefreq: "daily", priority: "1.0" },
      { loc: `${BASE}/search`, changefreq: "daily", priority: "0.9" },
      { loc: `${BASE}/compare`, changefreq: "weekly", priority: "0.6" },
      { loc: `${BASE}/privacy`, changefreq: "yearly", priority: "0.3" },
      { loc: `${BASE}/terms`, changefreq: "yearly", priority: "0.3" },
      ...brandRows.map((b) => ({
        loc: `${BASE}/brands/${b.slug}`,
        changefreq: "weekly",
        priority: "0.7",
      })),
      ...corridors.flatMap(({ from, to }) => {
        const [a, b] = [cityName.get(from), cityName.get(to)];
        return a && b ? [{ loc: corridorUrl(a, b), changefreq: "daily", priority: "0.8" }] : [];
      }),
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url><loc>${xmlEscape(u.loc)}</loc><lastmod>${now}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`,
  )
  .join("\n")}
</urlset>`;
    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`,
      { headers: { "Content-Type": "application/xml; charset=utf-8" } },
    );
  }
}
