/** `/robots.txt` — the Rust build's text (`routes/seo.rs`), one rule group for every crawler. */
export const SITE_URL = "https://datxevui.com";

/** The public origin (`PAYMENT_PUBLIC_BASE_URL`, as Rust's `public_base_url`), without a trailing slash. */
export function publicBaseUrl(configured: string | undefined): string {
  const base = (configured ?? "").trim().replace(/\/+$/, "");
  return base || SITE_URL;
}

export function robotsTxt(baseUrl: string): string {
  return [
    "# https://www.robotstxt.org/robotstxt.html",
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /admin/",
    "Disallow: /bookings/",
    "Disallow: /payments/",
    "Crawl-delay: 1",
    "",
    `Sitemap: ${baseUrl}/sitemap.xml`,
    "",
  ].join("\n");
}
