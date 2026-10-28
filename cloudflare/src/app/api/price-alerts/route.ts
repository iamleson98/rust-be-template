import { limitWrite } from "@/lib/rate-limit";
import { currentUser, handleRouteError, readJson, requireUser } from "@/lib/api";
import { intParam } from "@/lib/services/http-errors";
import {
  createPriceAlert,
  listPriceAlerts,
  validateCreateAlert,
  type CreatePriceAlertBody,
} from "@/lib/services/price-alerts";

/**
 * `GET /api/price-alerts` — the signed-in caller's alerts; with no session,
 * `?phone=` looks up a guest's (the dialog's preview before login).
 */
export async function GET(req: Request) {
  try {
    const user = await currentUser(req);
    const q = new URL(req.url).searchParams;
    return Response.json(
      await listPriceAlerts({
        userId: user?.id ?? null,
        phone: q.get("phone"),
        status: q.get("status"),
        limit: intParam("limit", q.get("limit"), 20),
        offset: intParam("offset", q.get("offset"), 0),
      }),
    );
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `POST /api/price-alerts` — create an alert, or return the identical active one (`duplicate: true`). */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    await limitWrite("price-alert", user.id);
    const body = await readJson<CreatePriceAlertBody>(req);
    const price = validateCreateAlert(body);
    const { alert, duplicate } = await createPriceAlert(user.id, body, price);
    return Response.json({ ...alert, duplicate });
  } catch (e) {
    return handleRouteError(e);
  }
}
