import { ApiError } from "@/lib/auth/rbac";

/** A non-negative integer query parameter (Rust `Option<u64>`); a malformed one is a 400. */
export function optionalCount(params: URLSearchParams, name: string): number | undefined {
  const raw = params.get(name);
  if (raw === null || raw === "") return undefined;
  if (!/^\d{1,15}$/.test(raw)) {
    throw new ApiError(400, "bad_request", `invalid query parameter '${name}'`);
  }
  return Number(raw);
}
