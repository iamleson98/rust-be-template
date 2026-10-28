import { handleRouteError, requireUser } from "@/lib/api";
import { authResponse } from "@/lib/auth/session";

/** `GET /api/auth/me` — the signed-in user (Rust `AuthResponse`, no tokens). */
export async function GET(req: Request) {
  try {
    return await authResponse(req, await requireUser(req));
  } catch (e) {
    return handleRouteError(e);
  }
}
