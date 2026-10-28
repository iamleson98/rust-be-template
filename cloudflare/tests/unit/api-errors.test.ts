import { afterEach, describe, expect, it, vi } from "vitest";
import { handleRouteError, INTERNAL_ERROR_MESSAGE } from "@/lib/api";
import { ApiError } from "@/lib/auth/rbac";

afterEach(() => vi.restoreAllMocks());

async function body(res: Response) {
  return (await res.json()) as { error: string; message: string };
}

describe("handleRouteError", () => {
  it("keeps the message of an expected 4xx", async () => {
    const res = handleRouteError(new ApiError(409, "conflict", "seat already taken"));
    expect(res.status).toBe(409);
    expect(await body(res)).toEqual({
      error: "conflict",
      message: "conflict: seat already taken",
    });
  });

  it("passes Retry-After through", () => {
    const res = handleRouteError(new ApiError(429, "rate-limited", "slow down", 12));
    expect(res.headers.get("retry-after")).toBe("12");
  });

  it("never leaks the detail of an unexpected exception", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = handleRouteError(new Error("D1_ERROR: no such column: user.password_hash"));
    expect(res.status).toBe(500);
    expect(await body(res)).toEqual({ error: "internal_error", message: INTERNAL_ERROR_MESSAGE });
  });

  it("never leaks the detail of a deliberate 500", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = handleRouteError(new ApiError(500, "internal", "MoMo parse failed body=<secret>"));
    expect((await body(res)).message).toBe(INTERNAL_ERROR_MESSAGE);
    expect(JSON.stringify(log.mock.calls)).toContain("MoMo parse failed");
  });

  it("keeps the message of a 503 (Rust ServiceUnavailable is public)", async () => {
    const res = handleRouteError(new ApiError(503, "unavailable", "MoMo is unreachable"));
    expect((await body(res)).message).toBe("service unavailable: MoMo is unreachable");
  });
});
