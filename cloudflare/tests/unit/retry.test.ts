import { describe, expect, it, vi } from "vitest";
import { withRetry, isTransientDbError } from "@/lib/db/retry";

/** Minimal stand-in for the app's ApiError (numeric `status`). */
class FakeApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

describe("isTransientDbError", () => {
  it("classifies D1 internal errors as transient", () => {
    expect(isTransientDbError(new Error("D1_ERROR: internal error (bulk request)"))).toBe(true);
  });
  it("classifies SQLITE_BUSY as transient", () => {
    expect(isTransientDbError(new Error("SQLITE_BUSY: database is locked"))).toBe(true);
  });
  it("classifies dropped network connections as transient", () => {
    expect(isTransientDbError(new Error("Network connection lost."))).toBe(true);
  });
  it("classifies constraint violations as permanent", () => {
    expect(isTransientDbError(new Error("UNIQUE constraint failed: user.email"))).toBe(false);
    expect(isTransientDbError(new Error("FOREIGN KEY constraint failed"))).toBe(false);
  });
  it("classifies 4xx ApiErrors as permanent (deterministic)", () => {
    expect(isTransientDbError(new FakeApiError("conflict", 409))).toBe(false);
  });
  it("classifies 5xx ApiErrors as transient", () => {
    expect(isTransientDbError(new FakeApiError("internal", 500))).toBe(true);
  });
});

describe("withRetry", () => {
  it("runs once when the first attempt succeeds", async () => {
    const fn = vi.fn(async () => "ok");
    await expect(withRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures until success", async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      if (attempts < 3) throw new Error("SQLITE_BUSY: database is locked");
      return "recovered";
    };
    const onFailedAttempt = vi.fn();
    await expect(withRetry(fn, { minTimeout: 1, onFailedAttempt })).resolves.toBe("recovered");
    expect(attempts).toBe(3);
    expect(onFailedAttempt).toHaveBeenCalledTimes(2);
  });

  it("gives up after the retry budget and rethrows the original error", async () => {
    const boom = new Error("D1_ERROR: internal error");
    const fn = vi.fn(async () => {
      throw boom;
    });
    // identity must survive: callers match with instanceof / .code / .status
    await expect(withRetry(fn, { retries: 2, minTimeout: 1 })).rejects.toBe(boom);
    expect(fn).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it("never retries deterministic failures and preserves error identity", async () => {
    const conflict = new FakeApiError("UNIQUE constraint failed", 409);
    const fn = vi.fn(async () => {
      throw conflict;
    });
    await expect(withRetry(fn, { retries: 5, minTimeout: 1 })).rejects.toBe(conflict);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
