import { rawAll, atomicBatch } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";

type Params = { params: Promise<{ id: string }> };

/**
 * `PATCH /api/admin/payments/{id}` — force a payment status (complete,
 * cancel or refund) with an optional reason. Completing a pending payment
 * confirms its booking (same cascade as a verified gateway IPN).
 */
export async function PATCH(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:payments:write");
    const { id } = await ctx.params;
    const body = await readJson<{ status?: string; reason?: string | null }>(req);
    const status = body.status ?? "";
    if (!["completed", "failed", "cancelled", "refunded", "pending"].includes(status)) {
      return err(400, "validation", "unsupported status");
    }
    const rows = await rawAll<{ id: string; booking_id: string; status: string }>(
      sql`SELECT id, booking_id, status FROM payment WHERE id = ${id} LIMIT 1`,
    );
    const p = rows[0];
    if (!p) return err(404, "not-found", "payment not found");

    const now = new Date().toISOString();
    const stmts = [
      sql`UPDATE payment SET status = ${status}, failure_reason = ${body.reason ?? null}, updated_at = ${now} WHERE id = ${id}`,
    ];
    if (status === "completed" && p.status === "pending") {
      stmts.push(
        sql`UPDATE booking SET status = 'confirmed', updated_at = ${now} WHERE id = ${p.booking_id} AND status = 'pending'`,
        sql`
          UPDATE seat_inventory SET status = 'booked', held_until = NULL, updated_at = ${now}
          WHERE held_by_booking_id = ${p.booking_id} AND status = 'held'
        `,
      );
    }
    if (status === "cancelled" || status === "refunded") {
      stmts.push(
        sql`UPDATE payment SET status = ${status}, updated_at = ${now} WHERE id = ${id}`,
      );
    }
    await atomicBatch(stmts);

    const updated = (
      await rawAll<{ id: string; status: string; updated_at: string }>(
        sql`SELECT id, status, updated_at FROM payment WHERE id = ${id} LIMIT 1`,
      )
    )[0];
    return Response.json({
      paymentId: id,
      status: updated?.status ?? status,
      reason: body.reason ?? null,
      updatedAt: updated?.updated_at ?? now,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
