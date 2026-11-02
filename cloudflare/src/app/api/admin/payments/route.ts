import { staffRoute } from "@/lib/api";
import { adminListPayments } from "@/lib/services/payment";

/** `GET /api/admin/payments?status=&provider=&limit=&offset=` — every payment, newest first. */
export const GET = staffRoute("admin:payments:read", async (req) => {
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
});
