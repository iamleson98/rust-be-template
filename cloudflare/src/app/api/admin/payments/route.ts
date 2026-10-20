import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { adminListPayments } from "@/lib/services/payment";

/** `GET /api/admin/payments?status=&provider=&limit=&offset=` — every payment, newest first. */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:payments:read");
    const p = new URL(req.url).searchParams;
    const num = (key: string): number | null => {
      const n = Number(p.get(key));
      return p.has(key) && Number.isInteger(n) && n >= 0 ? n : null;
    };
    return Response.json(
      await adminListPayments({
        status: p.get("status"),
        provider: p.get("provider"),
        limit: num("limit"),
        offset: num("offset"),
      }),
    );
  } catch (e) {
    return handleRouteError(e);
  }
}
