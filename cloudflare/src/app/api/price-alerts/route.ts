import { getDb } from "@/lib/db/client";
import { priceAlerts } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { handleRouteError, readJson, requireUser, err } from "@/lib/api";

/** `GET /api/price-alerts` — the caller's watch list (users see own; staff see all). */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);
    const db = await getDb();
    const staff = user.role === "employee" || user.role === "admin";
    const rows = await db
      .select()
      .from(priceAlerts)
      .where(staff ? undefined : eq(priceAlerts.userId, user.id))
      .orderBy(desc(priceAlerts.createdAt))
      .limit(limit)
      .offset(offset);
    return Response.json({
      items: rows.map(alertOut),
      limit,
      offset,
      total: rows.length + offset,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `POST /api/price-alerts` — create (or return the existing duplicate). */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await readJson<{
      phone?: string;
      email?: string | null;
      routeId?: string | null;
      fromName?: string;
      toName?: string;
      targetPrice?: number;
      frequency?: string | null;
    }>(req);
    const phone = (body.phone ?? "").trim();
    const fromName = (body.fromName ?? "").trim();
    const toName = (body.toName ?? "").trim();
    const targetPrice = Number(body.targetPrice);
    if (!phone) return err(400, "validation", "phone required");
    if (!fromName || !toName) return err(400, "validation", "fromName and toName required");
    if (!Number.isFinite(targetPrice) || targetPrice <= 0)
      return err(400, "validation", "targetPrice must be positive");
    const frequency = body.frequency === "weekly" ? "weekly" : "daily";

    const db = await getDb();
    const dup = (
      await db
        .select()
        .from(priceAlerts)
        .where(
          and(
            eq(priceAlerts.phone, phone),
            eq(priceAlerts.fromName, fromName),
            eq(priceAlerts.toName, toName),
            eq(priceAlerts.status, "active"),
          ),
        )
        .limit(1)
    )[0];
    if (dup) return Response.json(alertOut(dup), { status: 201 });

    const id = crypto.randomUUID();
    const row = {
      id,
      userId: user.id,
      phone,
      email: body.email ?? null,
      routeId: body.routeId ?? null,
      fromName,
      toName,
      targetPrice,
      frequency,
      status: "active",
      lastTriggeredAt: null,
      expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
      createdAt: new Date().toISOString(),
    };
    await db.insert(priceAlerts).values(row);
    void user;
    return Response.json(alertOut({ ...row } as typeof priceAlerts.$inferSelect), { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}

function alertOut(a: typeof priceAlerts.$inferSelect) {
  return {
    id: a.id,
    phone: a.phone,
    email: a.email,
    routeId: a.routeId,
    fromName: a.fromName,
    toName: a.toName,
    targetPrice: a.targetPrice,
    frequency: a.frequency,
    status: a.status,
    lastTriggeredAt: a.lastTriggeredAt,
    expiresAt: a.expiresAt,
    createdAt: a.createdAt,
  };
}
