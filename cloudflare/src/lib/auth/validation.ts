/**
 * Request validation shared by the auth routes — the `validator` rules of the
 * Rust DTOs (`routes/auth.rs`) and `validation.rs`, reported the way
 * `AppError::from_validation_errors` words them: `"<field> <reason>"`, sorted
 * and joined with `"; "`, as a 400 `validation_error`.
 */
import { ApiError } from "./rbac";

export type Reason = "email" | "length" | "invalid_phone" | "empty_phone" | "invalid";

const REASON_TEXT: Record<Reason, string> = {
  email: "must be a valid email address",
  length: "has an invalid length",
  invalid_phone: "must be a valid phone number",
  empty_phone: "cannot be empty",
  invalid: "is invalid",
};

/** Collects every broken rule of a body before answering, like `Validate::validate`. */
export class Issues {
  private readonly messages: string[] = [];

  add(field: string, reason: Reason): void {
    this.messages.push(`${field} ${REASON_TEXT[reason]}`);
  }

  /** `validator`'s `length(min, max)` counts characters, not bytes. */
  length(field: string, value: string, min: number, max: number): void {
    const n = [...value].length;
    if (n < min || n > max) this.add(field, "length");
  }

  email(field: string, value: string): void {
    if (!isEmail(value)) this.add(field, "email");
  }

  phone(field: string, value: string): void {
    if (value === "") this.add(field, "empty_phone");
    else if (!isVietnamesePhone(value)) this.add(field, "invalid_phone");
  }

  throwIfAny(): void {
    if (this.messages.length === 0) return;
    throw new ApiError(400, "validation_error", [...this.messages].sort().join("; "));
  }
}

const EMAIL =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/** The HTML5 address grammar `validator::validate_email` implements (local part ≤ 64). */
export function isEmail(value: string): boolean {
  const at = value.lastIndexOf("@");
  return at > 0 && at <= 64 && EMAIL.test(value);
}

/** Rust `validation::validate_phone`: `+` and up to 16 chars, or `0…` with 9–20 digits. */
export function isVietnamesePhone(phone: string): boolean {
  if (phone.startsWith("+")) return /^\+\d*$/.test(phone) && phone.length <= 16;
  return phone.startsWith("0") && /^\d+$/.test(phone) && phone.length >= 9 && phone.length <= 20;
}

/** Rust `str::len()` — UTF-8 bytes — which `AuthService` uses for its own length rules. */
export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** A string field of a JSON body; anything else counts as missing. */
export function str(body: Record<string, unknown>, key: string): string | undefined {
  const v = body[key];
  return typeof v === "string" ? v : undefined;
}

/** The JSON object of a request, or a 400 (axum answers a body it cannot deserialize with 4xx too). */
export function asObject(body: unknown): Record<string, unknown> {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  throw new ApiError(400, "bad_request", "request body must be a JSON object");
}
