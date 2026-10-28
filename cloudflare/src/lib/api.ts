/**
 * API helpers — JSON envelope, error mapping, guards for route handlers.
 */
import { ApiError } from "./auth/rbac";
import { currentUser, type SessionUser } from "./auth/session";
import { isStaff } from "./auth/rbac";

export { currentUser };
export type { SessionUser };

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

export function err(status: number, code: string, message: string, retryAfter?: number): Response {
  return Response.json(
    { error: { code, message } },
    {
      status,
      headers: retryAfter ? { "retry-after": String(Math.max(1, Math.ceil(retryAfter))) } : {},
    },
  );
}

/**
 * What a client is told about a server-side fault. Like Rust's `public_message`,
 * the detail (SQL, gateway bodies, paths) goes to the log, never to the caller.
 */
export const INTERNAL_ERROR_MESSAGE = "internal server error";

/** Convert thrown values into the standard error envelope. */
export function handleRouteError(e: unknown): Response {
  if (e instanceof ApiError) {
    if (e.status !== 500) return err(e.status, e.code, e.message, e.retryAfter);
    console.error("[api]", e.code, e.message);
    return err(500, e.code, INTERNAL_ERROR_MESSAGE);
  }
  console.error("[api]", e);
  return err(500, "internal", INTERNAL_ERROR_MESSAGE);
}

export async function requireUser(req: Request): Promise<SessionUser> {
  const user = await currentUser(req);
  if (!user) throw new ApiError(401, "unauthorized", "Authentication required");
  return user;
}

export async function requireStaff(req: Request): Promise<SessionUser> {
  const user = await requireUser(req);
  if (!isStaff(user)) throw new ApiError(403, "forbidden", "Staff access required");
  return user;
}

export function clientIp(req: Request): string {
  // Set by Cloudflare's edge on every request and not client-spoofable
  // (`request.cf` has no such field).
  const connecting = req.headers.get("cf-connecting-ip");
  if (connecting) return connecting;
  const xff = req.headers.get("x-forwarded-for");
  if (xff)
    return (
      xff
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .pop() ?? "unknown"
    );
  return "unknown";
}

export function parsePagination(
  url: URL,
  defLimit = 20,
  maxLimit = 100,
): { limit: number; offset: number } {
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? `${defLimit}`, 10) || defLimit, 1),
    maxLimit,
  );
  const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);
  return { limit, offset };
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError(400, "bad-json", "Request body must be valid JSON");
  }
}
