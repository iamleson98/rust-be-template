/**
 * The public campaign list (`GET /api/campaigns`) and its cache — the port
 * of Rust `CampaignService::public_campaigns` / `note_remaining`.
 *
 * One entry, `PUBLIC_TTL` long, in two places:
 *   - a per-isolate copy (answers repeat reads with no I/O and takes the
 *     claim write-through below), and
 *   - the Workers Cache API (`caches.default`, free, shared by every isolate
 *     of a colo, `s-maxage` = the TTL) so a cold isolate does not query D1.
 * No KV: a claim storm would otherwise turn into list+delete operations.
 *
 * The entry stores the *data*; `serverTime` is set and ended campaigns are
 * trimmed on every read, as in Rust. Claims always go to D1 and its
 * conditional UPDATE is the source of truth, so a slightly stale count here
 * can never oversell — it only shows a slot that is already gone.
 *
 * Invalidation (sold out, give-up, every admin write) clears the local copy
 * and this colo's Cache API entry. Other colos serve their entry until it
 * expires (<= `PUBLIC_TTL`); the cache API has no cross-colo purge.
 */
import { getDb } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import { brands, discountCampaignBrands, discountCampaigns, discountTiers } from "@/lib/db/schema";
import { and, asc, eq, gt, sql } from "drizzle-orm";

/** How long a loaded list may be served. Rust: 15 s; the edge entry uses 10 s. */
export const PUBLIC_TTL_SECS = 10;

/** Not a real host: Cache API keys must be URLs, this one never routes. */
const CACHE_KEY = "https://cache.datxevui.internal/campaigns/public/v1";

export interface PublicCampaign {
  id: string;
  name: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  couponValidity: string;
  allBrands: boolean;
  brands: Array<{ id: string; name: string; slug: string; logoUrl: string | null }>;
  tiers: Array<{ id: string; amount: number; remaining: number; totalSlots: number }>;
}

/** What is cached: the list and when it was loaded from D1 (epoch ms). */
interface Snapshot {
  items: PublicCampaign[];
  loadedAt: number;
}

let local: Snapshot | null = null;
/** One D1 load at a time per isolate (Rust `get_or_fetch` stampede guard). */
let loading: Promise<Snapshot> | null = null;
/** Bumped by every invalidation, so a load that began before it is not stored. */
let generation = 0;

const fresh = (s: Snapshot, nowMs: number) => nowMs - s.loadedAt < PUBLIC_TTL_SECS * 1000;

function edgeCache(): Cache | null {
  try {
    // `default` is a Workers extension the DOM lib types do not know.
    return typeof caches === "undefined" ? null : (caches as unknown as { default: Cache }).default;
  } catch {
    return null; // `next dev` and other runtimes without the Cache API
  }
}

/** Every campaign that is not paused and has not ended: running and upcoming. */
async function loadFromDb(): Promise<Snapshot> {
  return withRetry(async () => {
    const db = await getDb();
    const loadedAt = Date.now();
    const now = new Date(loadedAt).toISOString();
    const live = and(eq(discountCampaigns.paused, false), gt(discountCampaigns.endsAt, now));
    const rows = await db
      .select({
        id: discountCampaigns.id,
        name: discountCampaigns.name,
        description: discountCampaigns.description,
        startsAt: discountCampaigns.startsAt,
        endsAt: discountCampaigns.endsAt,
        couponValidity: discountCampaigns.couponValidity,
        allBrands: discountCampaigns.allBrands,
      })
      .from(discountCampaigns)
      .where(live)
      .orderBy(asc(discountCampaigns.startsAt));
    if (!rows.length) return { items: [], loadedAt };

    const liveIds = db.select({ id: discountCampaigns.id }).from(discountCampaigns).where(live);
    const brandRows = await db
      .select({
        campaignId: discountCampaignBrands.campaignId,
        id: brands.id,
        name: brands.name,
        slug: brands.slug,
        logoUrl: brands.logoUrl,
      })
      .from(discountCampaignBrands)
      .innerJoin(brands, eq(brands.id, discountCampaignBrands.brandId))
      .where(sql`${discountCampaignBrands.campaignId} IN ${liveIds}`);
    const tierRows = await db
      .select({
        campaignId: discountTiers.campaignId,
        id: discountTiers.id,
        amount: discountTiers.amount,
        totalSlots: discountTiers.totalSlots,
        claimedSlots: discountTiers.claimedSlots,
      })
      .from(discountTiers)
      .where(sql`${discountTiers.campaignId} IN ${liveIds}`);

    const brandsBy = new Map<string, PublicCampaign["brands"]>();
    for (const b of brandRows) {
      const list = brandsBy.get(b.campaignId) ?? [];
      list.push({ id: b.id, name: b.name, slug: b.slug, logoUrl: b.logoUrl });
      brandsBy.set(b.campaignId, list);
    }
    const tiersBy = new Map<string, PublicCampaign["tiers"]>();
    for (const t of tierRows) {
      const list = tiersBy.get(t.campaignId) ?? [];
      list.push({
        id: t.id,
        amount: Number(t.amount),
        remaining: Math.max(0, Number(t.totalSlots) - Number(t.claimedSlots)),
        totalSlots: Number(t.totalSlots),
      });
      tiersBy.set(t.campaignId, list);
    }
    return {
      items: rows.map((c) => ({
        ...c,
        brands: brandsBy.get(c.id) ?? [],
        // Biggest discount first, as customers see it.
        tiers: (tiersBy.get(c.id) ?? []).sort((a, b) => b.amount - a.amount),
      })),
      loadedAt,
    };
  });
}

/** A snapshot from the colo's Cache API entry, if there is a fresh one. */
async function readEdge(): Promise<Snapshot | null> {
  const cache = edgeCache();
  if (!cache) return null;
  try {
    const hit = await cache.match(CACHE_KEY);
    if (!hit) return null;
    const snap: Snapshot = await hit.json();
    return fresh(snap, Date.now()) ? snap : null;
  } catch {
    return null; // a cache hiccup must never break a request
  }
}

async function writeEdge(snap: Snapshot): Promise<void> {
  const cache = edgeCache();
  if (!cache) return;
  try {
    await cache.put(
      CACHE_KEY,
      new Response(JSON.stringify(snap), {
        headers: {
          "content-type": "application/json",
          "cache-control": `public, s-maxage=${PUBLIC_TTL_SECS}`,
        },
      }),
    );
  } catch {
    // best-effort, the entry expires on its own
  }
}

async function snapshot(): Promise<Snapshot> {
  if (local && fresh(local, Date.now())) return local;
  if (loading) return loading;
  const startedIn = generation;
  const run = (async () => {
    let snap = await readEdge();
    if (!snap) {
      snap = await loadFromDb();
      // A change that landed while this loaded must not be overwritten by
      // the older read: it is served to this caller only.
      if (startedIn === generation) await writeEdge(snap);
    }
    if (startedIn === generation) local = snap;
    return snap;
  })();
  loading = run;
  try {
    return await run;
  } finally {
    if (loading === run) loading = null;
  }
}

/**
 * Running and upcoming campaigns. One that ended since it was cached is
 * dropped here; `serverTime` is always the moment of this response.
 */
export async function publicCampaigns(): Promise<{ items: PublicCampaign[]; serverTime: string }> {
  const snap = await snapshot();
  const now = new Date().toISOString();
  return { items: snap.items.filter((c) => c.endsAt > now), serverTime: now };
}

/**
 * Writes a claim's exact slot count into this isolate's copy, so the next
 * reader here (usually the claimer) sees the slot gone without a query.
 * Counts only go down (a racing claim that read an older count never raises
 * it; slots coming back invalidate instead) and the entry keeps its
 * original load time, so it still expires on schedule.
 */
export function noteRemaining(tierId: string, remaining: number): void {
  if (!local || !fresh(local, Date.now())) return; // nothing cached: the next read loads fresh counts
  for (const campaign of local.items) {
    const tier = campaign.tiers.find((t) => t.id === tierId);
    if (!tier) continue;
    if (remaining < tier.remaining) tier.remaining = Math.max(0, remaining);
    return;
  }
}

/** Drop the cached list (sold out, slot given back, any admin write). */
export async function invalidateCampaigns(): Promise<void> {
  generation++;
  local = null;
  loading = null;
  const cache = edgeCache();
  if (!cache) return;
  try {
    await cache.delete(CACHE_KEY);
  } catch {
    // best-effort: the entry expires on its own
  }
}

/** Test hook: forget this isolate's copy (the Cache API entry is untouched). */
export function clearCampaignMemory(): void {
  generation++;
  local = null;
  loading = null;
}
