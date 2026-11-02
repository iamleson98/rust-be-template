/**
 * Checks for admin write bodies. On an update a key left out keeps its value,
 * so each helper returns `undefined` for an absent key, `null` for one the
 * caller clears, and the checked value otherwise; a bad value is a 400.
 */
import { badRequest } from "./http-errors";

export type Body = Record<string, unknown>;

export const isRecord = (v: unknown): v is Body =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The body as an object, or 400. */
export function objectBody(v: unknown): Body {
  if (!isRecord(v)) throw badRequest("body must be a JSON object");
  return v;
}

/** A trimmed string of at most `max` characters; `""` and `null` clear it. */
export function optionalText(body: Body, key: string, max: number): string | null | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") throw badRequest(`${key} must be a string`);
  const t = v.trim();
  if (t.length > max) throw badRequest(`${key} must be at most ${max} characters`);
  return t || null;
}

/** Like `optionalText`, but a present value may not be cleared. */
export function requiredText(body: Body, key: string, max: number): string | undefined {
  const v = optionalText(body, key, max);
  if (v === null) throw badRequest(`${key} must not be empty`);
  return v;
}

/** One of `allowed`, or absent. */
export function optionalOneOf<T extends string>(
  body: Body,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (!allowed.includes(v as T)) throw badRequest(`${key} must be one of ${allowed.join(", ")}`);
  return v as T;
}

/** A whole number in `min..max`, or absent; `null` clears it. */
export function optionalInt(
  body: Body,
  key: string,
  min: number,
  max: number,
): number | null | undefined {
  const v = body[key];
  if (v === undefined || v === null) return v;
  if (!Number.isInteger(v) || (v as number) < min || (v as number) > max)
    throw badRequest(`${key} must be a whole number from ${min} to ${max}`);
  return v as number;
}

/** Active or not: the status every catalog row carries. */
export const STATUSES = ["active", "inactive"] as const;
