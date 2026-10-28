/**
 * The API error envelope, byte-for-byte the Rust one (`src/error.rs`):
 *
 *     { "error": "<kind>", "message": "<display of the variant>" }
 *
 * `kind` is `AppError::kind()` and `message` is the thiserror display
 * (`"unauthorized: invalid credentials"`, `"resource not found: …"`), with the
 * server-side faults masked as `"internal server error"` so no SQL, hostname
 * or stack trace reaches a client. Every error response of the app goes
 * through `errorBody` (route errors in `api.ts`, the edge guard's 403/429), so
 * the shape is decided in exactly one place.
 *
 * Route code keeps calling `err(status, code, text)`: `code` may be a Rust kind
 * (`"conflict"`, `"store_error"`) or one of the port's older names
 * (`"validation"`, `"not-found"`); anything else is derived from the status.
 */
export type ErrorKind =
  | "not_found"
  | "validation_error"
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "conflict"
  | "store_error"
  | "gone"
  | "service_unavailable"
  | "too_many_requests"
  | "internal_error";

/** `#[error("…")]` prefix of each variant, exactly as `AppError` displays it. */
const DISPLAY_PREFIX: Record<ErrorKind, string> = {
  not_found: "resource not found",
  validation_error: "validation failed",
  bad_request: "bad request",
  unauthorized: "unauthorized",
  // Rust prints every `AppError::Forbidden(x)` as "forbidden: missing permission: x".
  forbidden: "forbidden: missing permission",
  conflict: "conflict",
  store_error: "store error",
  gone: "resource gone",
  service_unavailable: "service unavailable",
  too_many_requests: "too many requests",
  internal_error: "internal error",
};

const KINDS = new Set<string>(Object.keys(DISPLAY_PREFIX));

/** The port's pre-envelope error codes that name a Rust kind. */
const KIND_ALIASES: Record<string, ErrorKind> = {
  validation: "validation_error",
  "bad-json": "bad_request",
  "not-found": "not_found",
};

const KIND_BY_STATUS: Record<number, ErrorKind> = {
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  410: "gone",
  429: "too_many_requests",
  501: "service_unavailable",
  503: "service_unavailable",
};

export function errorKind(status: number, code?: string): ErrorKind {
  if (code && KINDS.has(code)) return code as ErrorKind;
  if (code && KIND_ALIASES[code]) return KIND_ALIASES[code];
  if (KIND_BY_STATUS[status]) return KIND_BY_STATUS[status];
  return status >= 500 ? "internal_error" : "bad_request";
}

export interface ErrorBody {
  error: ErrorKind;
  message: string;
}

/** Server faults are logged, never shown (Rust `AppError::public_message`). */
export const INTERNAL_MESSAGE = "internal server error";

export function errorBody(status: number, code: string | undefined, detail: string): ErrorBody {
  const kind = errorKind(status, code);
  if (kind === "internal_error") return { error: kind, message: INTERNAL_MESSAGE };
  return { error: kind, message: `${DISPLAY_PREFIX[kind]}: ${detail}` };
}

export function errorResponse(
  status: number,
  code: string | undefined,
  detail: string,
  init: { retryAfter?: number; headers?: HeadersInit } = {},
): Response {
  const headers = new Headers(init.headers);
  if (init.retryAfter) headers.set("retry-after", String(Math.max(1, Math.ceil(init.retryAfter))));
  return Response.json(errorBody(status, code, detail), { status, headers });
}
