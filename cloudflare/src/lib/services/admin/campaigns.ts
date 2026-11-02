/**
 * Admin discount campaigns — `GET/POST /api/admin/campaigns` and
 * `GET/PATCH/DELETE /api/admin/campaigns/{id}`.
 *
 * One parser checks a campaign the way the editor does
 * (`spa/features/admin/campaigns/form.ts`), so the server holds the rules
 * the editor promises: the name and description lengths, a real window of at
 * most a year, a brand scope, and 1–20 tiers of 1,000–10,000,000 VND in whole
 * thousands, none twice. An edit also respects what customers already hold:
 * once a campaign has started or handed out a coupon its start is fixed, once
 * it has handed one out its coupon validity is fixed, and a tier someone
 * claimed keeps its amount and never shrinks below its claims.
 *
 * Every write is one atomic batch; the public campaign cache is cleared after.
 */
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { atomicBatch, getDb, type AtomicStatement } from "@/lib/db/client";
import { brands, discountCampaignBrands, discountCampaigns, discountTiers } from "@/lib/db/schema";
import { campaignOut } from "../campaign-out";
import { invalidateCampaigns } from "../campaign-public";
import { badRequest, notFound } from "../http-errors";
import { isRecord, objectBody } from "../input";

const MAX_TIERS = 20;
const MIN_AMOUNT = 1_000;
const MAX_AMOUNT = 10_000_000;
const MAX_SLOTS = 1_000_000;
const MAX_DAYS = 366;
const DAY_MS = 86_400_000;

interface TierInput {
  id: string | null;
  amount: number;
  totalSlots: number;
}

interface CampaignInput {
  name: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  couponValidity: "campaign" | "permanent";
  allBrands: boolean;
  brandIds: string[];
  paused: boolean;
  tiers: TierInput[];
}

const wholeNumber = (v: unknown, min: number, max: number) =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** The request, checked on its own; the rules that depend on the stored campaign come after. */
function parseCampaign(raw: unknown): CampaignInput {
  const body = objectBody(raw);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 3 || name.length > 120) throw badRequest("name must be 3..120 characters");
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (description.length > 1000) throw badRequest("description must be at most 1000 characters");

  const startsAt = typeof body.startsAt === "string" ? body.startsAt : "";
  const endsAt = typeof body.endsAt === "string" ? body.endsAt : "";
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (Number.isNaN(start) || Number.isNaN(end))
    throw badRequest("startsAt and endsAt must be dates");
  if (end <= start) throw badRequest("endsAt must be after startsAt");
  if (end - start > MAX_DAYS * DAY_MS)
    throw badRequest(`a campaign lasts at most ${MAX_DAYS} days`);

  const allBrands = body.allBrands !== false;
  const brandIds = Array.isArray(body.brandIds)
    ? [...new Set(body.brandIds.filter((b): b is string => typeof b === "string"))]
    : [];
  if (!allBrands && brandIds.length === 0) throw badRequest("choose at least one brand");

  if (!Array.isArray(body.tiers) || body.tiers.length === 0 || body.tiers.length > MAX_TIERS)
    throw badRequest(`a campaign has 1..${MAX_TIERS} tiers`);
  const amounts = new Set<number>();
  const tiers = body.tiers.map((t: unknown): TierInput => {
    if (!isRecord(t)) throw badRequest("each tier must be an object");
    if (!wholeNumber(t.amount, MIN_AMOUNT, MAX_AMOUNT) || (t.amount as number) % 1000 !== 0)
      throw badRequest(`a tier is ${MIN_AMOUNT}..${MAX_AMOUNT} VND in whole thousands`);
    if (amounts.has(t.amount as number)) throw badRequest("two tiers have the same amount");
    amounts.add(t.amount as number);
    if (!wholeNumber(t.totalSlots, 1, MAX_SLOTS))
      throw badRequest(`a tier has 1..${MAX_SLOTS} slots`);
    return {
      id: typeof t.id === "string" && t.id ? t.id : null,
      amount: t.amount as number,
      totalSlots: t.totalSlots as number,
    };
  });

  return {
    name,
    description: description || null,
    startsAt,
    endsAt,
    couponValidity: body.couponValidity === "permanent" ? "permanent" : "campaign",
    allBrands,
    brandIds: allBrands ? [] : brandIds,
    paused: body.paused === true,
    tiers,
  };
}

async function assertBrandsExist(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  const found = await db.select({ id: brands.id }).from(brands).where(inArray(brands.id, ids));
  if (found.length !== ids.length) throw badRequest("brandIds names a brand that does not exist");
}

/** The brand links and tiers of `campaignId` as `input` lists them, tiers in its order. */
function scopeAndTierWrites(
  db: Awaited<ReturnType<typeof getDb>>,
  campaignId: string,
  input: CampaignInput,
  now: string,
): AtomicStatement[] {
  const keepIds = input.tiers.flatMap((t) => (t.id ? [t.id] : []));
  return [
    db.delete(discountCampaignBrands).where(eq(discountCampaignBrands.campaignId, campaignId)),
    ...input.brandIds.map((brandId) =>
      db.insert(discountCampaignBrands).values({ campaignId, brandId }).onConflictDoNothing(),
    ),
    // Tiers the request no longer lists go; the others keep their claim counters.
    db
      .delete(discountTiers)
      .where(
        and(
          eq(discountTiers.campaignId, campaignId),
          keepIds.length > 0 ? notInArray(discountTiers.id, keepIds) : undefined,
        ),
      ),
    ...input.tiers.map((t, position) =>
      t.id
        ? db
            .update(discountTiers)
            .set({
              amount: t.amount,
              // Never below what customers already claimed.
              totalSlots: sql`MAX(${t.totalSlots}, ${discountTiers.claimedSlots})`,
              position,
            })
            .where(and(eq(discountTiers.id, t.id), eq(discountTiers.campaignId, campaignId)))
        : db.insert(discountTiers).values({
            id: crypto.randomUUID(),
            campaignId,
            amount: t.amount,
            totalSlots: t.totalSlots,
            claimedSlots: 0,
            position,
            createdAt: now,
          }),
    ),
  ];
}

/** `GET /api/admin/campaigns`: every campaign, newest first, running or not. */
export async function adminCampaignList() {
  const db = await getDb();
  const rows = await db
    .select({ id: discountCampaigns.id })
    .from(discountCampaigns)
    .orderBy(sql`${discountCampaigns.createdAt} DESC`);
  return { items: (await Promise.all(rows.map((r) => campaignOut(r.id)))).filter(Boolean) };
}

/** `POST /api/admin/campaigns`. */
export async function createCampaign(raw: unknown, adminId: string): Promise<{ id: string }> {
  const input = parseCampaign(raw);
  if (Date.parse(input.endsAt) <= Date.now()) throw badRequest("endsAt is in the past");
  await assertBrandsExist(input.brandIds);
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await atomicBatch([
    db.insert(discountCampaigns).values({
      id,
      name: input.name,
      description: input.description,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      couponValidity: input.couponValidity,
      allBrands: input.allBrands,
      paused: input.paused,
      createdBy: adminId,
      createdAt: now,
      updatedAt: now,
    }),
    ...scopeAndTierWrites(
      db,
      id,
      { ...input, tiers: input.tiers.map((t) => ({ ...t, id: null })) },
      now,
    ),
  ]);
  await invalidateCampaigns();
  return { id };
}

/** `PATCH /api/admin/campaigns/{id}`: the whole campaign, within what its claims allow. */
export async function updateCampaign(id: string, raw: unknown) {
  const input = parseCampaign(raw);
  const db = await getDb();
  const [current] = await db.select().from(discountCampaigns).where(eq(discountCampaigns.id, id));
  if (!current) throw notFound("campaign not found");
  const tiers = await db.select().from(discountTiers).where(eq(discountTiers.campaignId, id));
  const claimed = tiers.some((t) => t.claimedSlots > 0);
  const started = Date.parse(current.startsAt) <= Date.now();

  if ((started || claimed) && input.startsAt !== current.startsAt)
    throw badRequest("the start of a running campaign cannot move");
  if (claimed && input.couponValidity !== current.couponValidity)
    throw badRequest("coupon validity is fixed once coupons are handed out");
  if (input.endsAt !== current.endsAt && Date.parse(input.endsAt) <= Date.now())
    throw badRequest("endsAt is in the past");
  const byId = new Map(tiers.map((t) => [t.id, t]));
  for (const t of input.tiers) {
    const stored = t.id ? byId.get(t.id) : undefined;
    if (t.id && !stored) throw badRequest("a tier id does not belong to this campaign");
    if (stored && stored.claimedSlots > 0 && stored.amount !== t.amount)
      throw badRequest("a tier with claimed coupons keeps its amount");
  }
  const listed = new Set(input.tiers.map((t) => t.id));
  if (tiers.some((t) => t.claimedSlots > 0 && !listed.has(t.id)))
    throw badRequest("a tier with claimed coupons cannot be removed");
  await assertBrandsExist(input.brandIds);

  const now = new Date().toISOString();
  await atomicBatch([
    db
      .update(discountCampaigns)
      .set({
        name: input.name,
        description: input.description,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        couponValidity: input.couponValidity,
        allBrands: input.allBrands,
        paused: input.paused,
        updatedAt: now,
      })
      .where(eq(discountCampaigns.id, id)),
    ...scopeAndTierWrites(db, id, input, now),
  ]);
  await invalidateCampaigns();
  return campaignOut(id);
}

/** `DELETE /api/admin/campaigns/{id}`: tiers and brand links go with it. */
export async function deleteCampaign(id: string): Promise<{ id: string }> {
  const db = await getDb();
  const deleted = await db
    .delete(discountCampaigns)
    .where(eq(discountCampaigns.id, id))
    .returning({ id: discountCampaigns.id });
  if (deleted.length === 0) throw notFound("campaign not found");
  await invalidateCampaigns();
  return { id };
}
