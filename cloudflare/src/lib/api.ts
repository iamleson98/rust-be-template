/**
 * API helpers — JSON envelope, error mapping, guards for route handlers.
 */
import { INTERNAL_MESSAGE, errorResponse } from "./error-envelope";
import { ApiError } from "./auth/rbac";
import { accessTokenOf, currentUser, type SessionUser } from "./auth/session";
import { isStaff } from "./auth/rbac";

export { currentUser };
export type { SessionUser };

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

/**
 * An error response in the Rust envelope `{ error: <kind>, message }` (see
 * `error-envelope.ts`). `code` is a Rust kind or one of the port's older names.
 */
export function err(status: number, code: string, message: string, retryAfter?: number): Response {
  return errorResponse(status, code, message, { retryAfter });
}

/**
 * What a client is told about a server-side fault. Like Rust's `public_message`,
 * the detail (SQL, gateway bodies, paths) goes to the log, never to the caller.
 */
export const INTERNAL_ERROR_MESSAGE = INTERNAL_MESSAGE;

/** Convert thrown values into the standard error envelope. */
export function handleRouteError(e: unknown): Response {
  if (e instanceof ApiError) {
    if (e.status !== 500) return err(e.status, e.code, e.message, e.retryAfter);
    console.error("[api]", e.code, e.message);
    return err(500, "internal_error", INTERNAL_ERROR_MESSAGE);
  }
  console.error("[api]", e);
  return err(500, "internal_error", INTERNAL_ERROR_MESSAGE);
}

/** Rust `AuthUser`: 401 "missing access token" / "invalid or expired token". */
export async function requireUser(req: Request): Promise<SessionUser> {
  const user = await currentUser(req);
  if (user) return user;
  throw new ApiError(
    401,
    "unauthorized",
    accessTokenOf(req) ? "invalid or expired token" : "missing access token",
  );
}

/** Rust `AdminUser`: 403 for an authenticated caller who is not staff. */
export async function requireStaff(req: Request): Promise<SessionUser> {
  const user = await requireUser(req);
  if (!isStaff(user)) throw new ApiError(403, "forbidden", "staff access required");
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

/** Like `readJson`, but an empty body is `{}` — only malformed JSON is an error. */
export async function readOptionalJson<T extends object>(req: Request): Promise<Partial<T>> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Partial<T>;
  } catch {
    throw new ApiError(400, "bad_request", "Request body must be valid JSON");
  }
}
