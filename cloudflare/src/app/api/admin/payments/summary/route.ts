import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";

/** `GET /api/admin/payments/summary` — status counts across all payments. */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:payments:read");
    const rows = await rawAll<{
      total: number;
      pending: number;
      completed: number;
      failed: number;
      cancelled: number;
      refunded: number;
      collected: number;
    }>(sql`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
             SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
             SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
             SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
             SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END) AS refunded,
             SUM(CASE WHEN collected_at IS NOT NULL THEN 1 ELSE 0 END) AS collected
      FROM payment
    `);
    const r = rows[0] ?? { total: 0, pending: 0, completed: 0, failed: 0, cancelled: 0, refunded: 0, collected: 0 };
    return Response.json({
      total: Number(r.total),
      pending: Number(r.pending),
      completed: Number(r.completed),
      failed: Number(r.failed),
      cancelled: Number(r.cancelled),
      refunded: Number(r.refunded),
      collected: Number(r.collected),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
