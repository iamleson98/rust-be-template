/**
 * Retry policy for store (D1) interactions — the JS-world best practice:
 * `p-retry` with exponential backoff and full jitter (`randomize: true`),
 * instead of hand-rolled retry loops.
 *
 * Only TRANSIENT errors are retried — D1 internal errors, SQLITE_BUSY /
 * SQLITE_LOCKED, dropped network connections, timeouts. Deterministic
 * failures (UNIQUE / FOREIGN KEY / CHECK violations, our own 4xx ApiError)
 * abort immediately: retrying them just masks bugs and burns latency.
 *
 * Retry READS and IDEMPOTENT writes only. Side-effecting writes (booking
 * creation, seat claims, payments) must not be retried here — a timed-out
 * request may have committed, and replaying it would double-book.
 */
import pRetry, { AbortError } from "p-retry";

/** Errors that mean "try again later". */
const TRANSIENT: RegExp[] = [
  /d1_error:\s*internal/i, // D1 internal error (retryable per Cloudflare guidance)
  /sqlite_(busy|locked|snapshot|readonly_rollback)/i,
  /network connection lost/i,
  /fetch failed/i,
  /\binternal error\b/i,
  /\btimeout\b|\betimedout\b/i,
  /\bservice unavailable\b|\bbad gateway\b/i,
];

/** Errors that mean "this will fail identically forever". */
const PERMANENT: RegExp[] = [
  /unique constraint/i,
  /foreign key/i,
  /check constraint/i,
  /not null constraint/i,
  /no such table/i,
  /no such column/i,
  /already exists/i,
  /syntax error/i,
  /too many sql variables/i,
];

/** Is this error worth retrying? Exposed for tests and call-site decisions. */
export function isTransientDbError(e: unknown): boolean {
  if (e instanceof Error && e.name === "AbortError") return false;
  const status = (e as { status?: unknown }).status;
  // 5xx errors (D1 surfaced as HTTP 5xx, upstream gateways) — retryable.
  if (typeof status === "number" && status >= 500) return true;
  // Our own API errors carry a numeric `status` — 4xx is deterministic.
  if (typeof status === "number" && status < 500) return false;
  const message = e instanceof Error ? e.message : String(e);
  if (PERMANENT.some((p) => p.test(message))) return false;
  return TRANSIENT.some((p) => p.test(message));
}

export interface RetryOptions {
  /** Attempts after the first try. Default 3 (so up to 4 executions). */
  retries?: number;
  /** First backoff in ms; doubles each attempt. Default 100. */
  minTimeout?: number;
  /** Cap per-attempt backoff. Default 2_000. */
  maxTimeout?: number;
  /** Total wall-clock budget. Default 5_000. */
  maxRetryTime?: number;
  /** Observability hook (also used by tests to assert attempt counts). */
  onFailedAttempt?: (error: Error, attemptNumber: number) => void;
}

/**
 * Run a store interaction under the retry policy. Non-transient failures
 * rethrow the ORIGINAL error untouched (error identity is preserved for
 * `ApiError` instanceof checks up the stack).
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  try {
    return await pRetry(
      async () => {
        try {
          return await fn();
        } catch (e) {
          if (!isTransientDbError(e)) {
            // AbortError stops p-retry; the original rides along inside.
            throw new AbortError(e instanceof Error ? e : new Error(String(e)));
          }
          throw e;
        }
      },
      {
        retries: opts.retries ?? 3,
        factor: 2,
        minTimeout: opts.minTimeout ?? 100,
        maxTimeout: opts.maxTimeout ?? 2_000,
        maxRetryTime: opts.maxRetryTime ?? 5_000,
        randomize: true, // full jitter — no synchronized retry storms
        onFailedAttempt: (ctx) => opts.onFailedAttempt?.(ctx.error, ctx.attemptNumber),
      },
    );
  } catch (e) {
    // Unwrap our own aborts so callers always see the real error.
    if (e instanceof AbortError && e.originalError) throw e.originalError;
    throw e;
  }
}
