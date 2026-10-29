/**
 * What a page tells search engines and link previews: its title,
 * description, canonical URL and whether it may be indexed. The server puts
 * it in the HTML `<head>` (what crawlers and Zalo / Facebook previews read
 * before any script runs) and the SPA keeps `document.title` in step after
 * client-side navigation, both from here, so the two never disagree.
 *
 * Pure: no React, no stores, no browser APIs.
 */

export const SITE_URL = "https://datxevui.com";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * - `public`: indexed, with a canonical URL.
 * - `noindex`: shown to anyone but not worth a search result; links followed.
 * - `private`: signed-in or staff pages; neither indexed nor followed.
 */
export type PageKind = "public" | "noindex" | "private";

/** Every page the SPA serves (`router/index.tsx`); any other path is a 404. */
const PAGES: Array<[RegExp, string, PageKind]> = [
  [/^\/$/, "home", "public"],
  [/^\/search$/, "search", "public"],
  [/^\/compare$/, "compare", "public"],
  [/^\/privacy$/, "privacy", "public"],
  [/^\/terms$/, "terms", "public"],
  [/^\/brands\/[^/]+$/, "brandDetail", "public"],
  // A trip departs and is gone: the page is not worth a search result, its links are.
  [/^\/trips\/[^/]+$/, "tripDetail", "noindex"],
  [/^\/bookings\/[^/]+$/, "bookingDetail", "private"],
  [/^\/login$/, "login", "private"],
  [/^\/admin(\/.*)?$/, "admin", "private"],
  [/^\/account(\/.*)?$/, "account", "private"],
];

/** The page `pathname` shows, or null when no page has that path. */
export function matchPage(pathname: string): { key: string; kind: PageKind } | null {
  for (const [pattern, key, kind] of PAGES) {
    if (pattern.test(pathname)) return { key, kind };
  }
  return null;
}

/**
 * The bus corridor a search is for, when it names both ends: such a search
 * is a page of its own ("vé xe Hà Nội đi Đà Nẵng"), whatever its date.
 */
export function searchRoute(search: URLSearchParams): { from: string; to: string } | null {
  const from = search.get("from")?.trim();
  const to = search.get("to")?.trim();
  return from && to ? { from, to } : null;
}

/** The only parameters that give a page a different canonical URL (and head). */
export const CANONICAL_PARAMS: Record<string, string[]> = { "/search": ["from", "to"] };

export interface PageSeo {
  title: string;
  description: string;
  /** Absolute; null for pages that are not indexed. */
  canonical: string | null;
  robots: "index, follow" | "noindex, follow" | "noindex, nofollow";
}

export interface PageFacts {
  /** The brand on `/brands/$slug`, when it exists. */
  brand?: { name: string; description: string | null };
}

/**
 * The head of `pathname` + `search`; null when no page has that path.
 * `facts` carries what only the database knows (a brand's name).
 */
export function pageSeo(
  pathname: string,
  search: URLSearchParams,
  t: Translate,
  facts: PageFacts = {},
): PageSeo | null {
  const page = matchPage(pathname);
  if (!page) return null;
  const robots =
    page.kind === "public"
      ? "index, follow"
      : page.kind === "noindex"
        ? "noindex, follow"
        : "noindex, nofollow";
  const route = page.key === "search" ? searchRoute(search) : null;

  let title = t(`seo.${page.key}.title`);
  let description = t(`seo.${page.key}.description`);
  if (route) {
    title = t("seo.searchRoute.title", route);
    description = t("seo.searchRoute.description", route);
  } else if (facts.brand) {
    const { name } = facts.brand;
    title = t("seo.brand.title", { name });
    description = facts.brand.description?.trim() || t("seo.brand.description", { name });
  }

  let canonical: string | null = null;
  if (page.kind === "public") {
    const url = new URL(pathname, SITE_URL);
    if (route) url.search = new URLSearchParams(route).toString();
    canonical = url.toString();
  }
  return { title, description, canonical, robots };
}
