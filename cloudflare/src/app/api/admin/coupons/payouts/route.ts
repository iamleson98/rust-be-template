import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError, requireStaff } from "@/lib/api";
import { isAdmin } from "@/lib/auth/rbac";

/** One aggregated payout row per brand (SUM columns are per-group, so
 * never null in SQLite — but kept nullable because D1 returns what it
 * returns and we coerce explicitly). */
interface PayoutRow {
  brand_id: string | null;
  brand_name: string | null;
  brand_slug: string | null;
  owed_count: number | null;
  owed_amount: number | null;
  paid_count: number | null;
  paid_amount: number | null;
}

/**
 * `GET /api/admin/coupons/payouts` — what each brand owes / has been paid
 * for redeemed coupons (Rust `PayoutListResponse`).
 */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    if (!isAdmin(staff)) {
      // employees read payouts for support follow-ups
    }
    const rows = await rawAll<PayoutRow>(sql`
      SELECT c.brand_id, br.name AS brand_name, br.slug AS brand_slug,
             SUM(CASE WHEN c.status = 'redeemed' THEN 1 ELSE 0 END) AS owed_count,
             SUM(CASE WHEN c.status = 'redeemed' THEN c.amount ELSE 0 END) AS owed_amount,
             SUM(CASE WHEN c.status = 'settled' THEN 1 ELSE 0 END) AS paid_count,
             SUM(CASE WHEN c.status = 'settled' THEN c.amount ELSE 0 END) AS paid_amount
      FROM coupon c
      LEFT JOIN brand br ON br.id = c.brand_id
      WHERE c.status IN ('redeemed', 'settled')
      GROUP BY c.brand_id, br.name, br.slug
      ORDER BY owed_amount DESC
    `);
    const sum = (k: "owed_amount" | "paid_amount"): number =>
      rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
    return Response.json({
      items: rows.map((r) => ({
        brand: r.brand_id ? { id: r.brand_id, name: r.brand_name, slug: r.brand_slug } : null,
        owedCount: Number(r.owed_count),
        owedAmount: Number(r.owed_amount),
        paidCount: Number(r.paid_count),
        paidAmount: Number(r.paid_amount),
      })),
      totalOwed: sum("owed_amount"),
      totalPaid: sum("paid_amount"),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
