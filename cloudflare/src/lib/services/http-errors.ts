/**
 * The Rust `AppError` kinds the chat/review/loyalty/media services raise,
 * as thrown `ApiError`s (status per `src/error.rs:106`).
 */
import { ApiError } from "@/lib/auth/rbac";

export const badRequest = (message: string) => new ApiError(400, "validation", message);
export const forbidden = (message: string) => new ApiError(403, "forbidden", message);
export const notFound = (message: string) => new ApiError(404, "not-found", message);
export const conflict = (message: string) => new ApiError(409, "conflict", message);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): boolean => UUID_RE.test(value);

/** The value if it is a UUID, else a 400 naming the parameter. */
export function uuidParam(name: string, value: string | null): string | null {
  if (value === null) return null;
  if (!isUuid(value)) throw badRequest(`invalid ${name}: ${value}`);
  return value;
}

/** Rust `validation::validate_phone`: `+` and ≤16 digits, or `0…` of 9–20 digits. */
export function validPhone(phone: string): boolean {
  if (phone.length === 0) return false;
  if (phone.startsWith("+")) return /^\d*$/.test(phone.slice(1)) && phone.length <= 16;
  return phone.startsWith("0") && /^\d+$/.test(phone) && phone.length >= 9 && phone.length <= 20;
}

/** A `u64` query parameter: absent → `fallback`; not a whole number → 400 (axum's `Query` rejection). */
export function intParam(name: string, value: string | null, fallback: number): number {
  if (value === null) return fallback;
  if (!/^\d{1,15}$/.test(value)) throw badRequest(`invalid ${name}: ${value}`);
  return Number(value);
}
