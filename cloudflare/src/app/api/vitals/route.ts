import { handleRouteError } from "@/lib/api";

/** `POST /api/vitals` — web-vitals beacon; acknowledged, not stored (yet). */
export async function POST() {
  try {
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleRouteError(e);
  }
}
