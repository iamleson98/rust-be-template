/**
 * Catch-all page: every non-API path. The SPA renders the page in the
 * browser (`../spa-entry.tsx`); this server half writes what must be in the
 * HTML before any script runs, for crawlers and link previews: the page's
 * own title, description, canonical URL and robots rule (`@spa/lib/seo`),
 * its structured data, and the hero image preload on the home page only.
 * A path no page has answers 404, so it never sits in an index as a copy
 * of the home page.
 */
import { cache } from "react";
import { preload } from "react-dom";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { brands } from "@/lib/db/schema";
import { vi } from "@spa/lib/i18n/vi";
import { matchPage, pageSeo, type PageFacts } from "@spa/lib/seo";
import { SpaEntry } from "../spa-entry";
import { FAQ_JSON_LD, SITE_OPEN_GRAPH, SITE_TWITTER } from "../structured-data";

type Props = {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Crawlers and previews get the default language. */
function t(key: string, params: Record<string, string | number> = {}): string {
  let text = vi[key] ?? key;
  for (const [name, value] of Object.entries(params))
    text = text.replaceAll(`{${name}}`, String(value));
  return text;
}

const pathOf = (slug: string[] | undefined) => `/${(slug ?? []).join("/")}`;

/** One D1 read per render, shared by the head and the page. */
const activeBrand = cache(async (slug: string) => {
  try {
    const db = await getDb();
    const row = await db
      .select({ name: brands.name, description: brands.description })
      .from(brands)
      .where(and(eq(brands.slug, slug), eq(brands.status, "active")))
      .get();
    return row ?? null;
  } catch {
    // The database is unreachable: the SPA still renders; the head stays generic.
    return undefined;
  }
});

/** What only the database knows about the page; `null` when its subject does not exist. */
async function factsOf(pathname: string): Promise<PageFacts | null> {
  const brandSlug = /^\/brands\/([^/]+)$/.exec(pathname)?.[1];
  if (!brandSlug) return {};
  const brand = await activeBrand(brandSlug);
  if (brand === null) return null;
  return brand ? { brand } : {};
}

function toSearch(raw: Record<string, string | string[] | undefined>): URLSearchParams {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") search.set(k, v);
    else if (v?.[0] !== undefined) search.set(k, v[0]);
  }
  return search;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const pathname = pathOf((await params).slug);
  const facts = await factsOf(pathname);
  const seo = facts && pageSeo(pathname, toSearch(await searchParams), t, facts);
  if (!seo) return { title: t("seo.notFound.title"), robots: { index: false, follow: true } };
  const robots = {
    index: seo.robots === "index, follow",
    follow: seo.robots !== "noindex, nofollow",
  };
  return {
    title: seo.title,
    description: seo.description,
    robots,
    ...(seo.canonical && {
      alternates: { canonical: seo.canonical },
      openGraph: {
        ...SITE_OPEN_GRAPH,
        title: seo.title,
        description: seo.description,
        url: seo.canonical,
      },
      twitter: { ...SITE_TWITTER, title: seo.title, description: seo.description },
    }),
  };
}

export default async function CatchAllPage({ params }: Props) {
  const pathname = pathOf((await params).slug);
  if (!matchPage(pathname) || (await factsOf(pathname)) === null) notFound();
  const home = pathname === "/";
  // The home page's largest paint; no other page shows it.
  if (home) {
    preload("/hero-vietnam-bus.avif", { as: "image", type: "image/avif", fetchPriority: "high" });
  }
  return (
    <>
      {home && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSON_LD) }}
        />
      )}
      <SpaEntry />
    </>
  );
}
