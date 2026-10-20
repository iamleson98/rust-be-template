/**
 * Stable coupon error codes — the `message` of the error, exactly as Rust's
 * `campaign_service::codes`. The apps translate them (`couponErrorCode` in
 * `src/spa/features/campaigns/api.ts` matches the message's ending), so
 * these strings are an API contract: never reword them.
 */
import { ApiError } from "@/lib/auth/rbac";

export const CAMPAIGN_CODES = {
  CUSTOMERS_ONLY: "customers_only",
  NOT_RUNNING: "campaign_not_running",
  ALREADY_HELD: "coupon_already_held",
  ALREADY_CLAIMED: "campaign_already_claimed",
  SOLD_OUT: "tier_sold_out",
  TRY_AGAIN: "try_again",
  UNAVAILABLE: "coupon_unavailable",
  EXPIRED: "coupon_expired",
  WRONG_OPERATOR: "coupon_not_for_this_operator",
} as const;

/** Rust `AppError::BadRequest(code)`: 400, `error.code` "bad_request". */
export const couponBadRequest = (code: string) => new ApiError(400, "bad_request", code);
/** Rust `AppError::Forbidden(code)`: 403. */
export const couponForbidden = (code: string) => new ApiError(403, "forbidden", code);
/** Rust `AppError::Conflict(code)`: 409. */
export const couponConflict = (code: string) => new ApiError(409, "conflict", code);
/** Rust `AppError::Gone(code)`: 410. */
export const couponGone = (code: string) => new ApiError(410, "gone", code);
