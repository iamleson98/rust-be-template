/**
 * Typed reads of a query string — what axum's `Query<T>` gives the Rust
 * handlers. A value that is present but unreadable (`?limit=abc`, even
 * `?limit=`) is a 400, not a silent default; a missing one is `undefined`.
 */
import { ApiError } from "@/lib/auth/rbac";

const U64_MAX = 18_446_744_073_709_551_615n;
const INTEGER = /^[+-]?\d+$/;
const FLOAT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function invalid(field: string, why: string): ApiError {
  return new ApiError(400, "validation", `Failed to deserialize query string: ${field}: ${why}`);
}

export interface QueryReader {
  /** The raw value; `undefined` when the parameter is absent. */
  string(field: string): string | undefined;
  /** An unsigned integer (Rust `u64`). */
  u64(field: string): number | undefined;
  /** A signed integer (Rust `i64`). */
  i64(field: string): number | undefined;
  /** A decimal number (Rust `f64`). */
  f64(field: string): number | undefined;
  /** `true` or `false` (Rust `bool`). */
  bool(field: string): boolean | undefined;
  /** Like the above, for parameters the handler cannot do without. */
  required: {
    string(field: string): string;
    f64(field: string): number;
  };
}

export function queryReader(params: URLSearchParams): QueryReader {
  const string = (field: string) => params.get(field) ?? undefined;
  const parse = <T>(field: string, read: (raw: string) => T | undefined, why: string) => {
    const raw = string(field);
    if (raw === undefined) return undefined;
    const value = read(raw);
    if (value === undefined) throw invalid(field, why);
    return value;
  };
  const u64 = (field: string) =>
    parse(
      field,
      (raw) => {
        if (!/^\+?\d+$/.test(raw) || BigInt(raw) > U64_MAX) return undefined;
        return Number(raw);
      },
      "invalid digit found in string",
    );
  const i64 = (field: string) =>
    parse(field, (raw) => (INTEGER.test(raw) ? Number(raw) : undefined), "invalid digit");
  const f64 = (field: string) =>
    parse(field, (raw) => (FLOAT.test(raw) ? Number(raw) : undefined), "invalid float literal");
  const need = <T>(field: string, read: (field: string) => T | undefined): T => {
    const value = read(field);
    if (value === undefined) throw invalid(field, "missing field");
    return value;
  };
  return {
    string,
    u64,
    i64,
    f64,
    bool: (field) =>
      parse(
        field,
        (raw) => (raw === "true" ? true : raw === "false" ? false : undefined),
        "provided string was not `true` or `false`",
      ),
    required: {
      string: (field) => need(field, string),
      f64: (field) => need(field, f64),
    },
  };
}

const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/**
 * A UUID as the database stores it (lower-case, hyphenated); a 400 for
 * anything else — what axum's `Path<Uuid>` / the store's `parse_uuid` reject.
 */
export function uuidParam(raw: string, field: string): string {
  if (!UUID.test(raw)) throw invalid(field, "invalid UUID");
  const hex = raw.replaceAll("-", "").toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
