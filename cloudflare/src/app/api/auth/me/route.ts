import { handleRouteError, requireUser } from "@/lib/api";
import { accessTtlSecs } from "@/lib/auth/jwt";
import { sessionUserOut } from "@/lib/auth/session";

/** `GET /api/auth/me` — the cookie session (Rust `AuthResponse`). */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    return Response.json({
      user: sessionUserOut(user),
      expires_at: new Date(Date.now() + (await accessTtlSecs()) * 1000).toISOString(),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
