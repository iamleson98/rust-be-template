import { describe, expect, it } from "vitest";
import { errorBody, errorKind } from "@/lib/error-envelope";
import { err, handleRouteError } from "@/lib/api";
import { ApiError } from "@/lib/auth/rbac";
import { Issues } from "@/lib/auth/validation";

/**
 * The wire shape of every error: `{ "error": "<kind>", "message": "<display>" }`
 * (Rust `src/error.rs`). Rust's own unit tests are ported here first.
 */
describe("Rust error.rs tests", () => {
  // server_faults_do_not_leak_their_detail
  it("server faults do not leak their detail", () => {
    for (const detail of [
      "UNIQUE constraint failed: user.email",
      "disk I/O error at /var/db/app.db",
      "redis://10.0.0.5:6379 refused",
    ]) {
      expect(errorBody(500, "internal_error", detail)).toEqual({
        error: "internal_error",
        message: "internal server error",
      });
    }
  });

  // client_errors_keep_their_message
  it("client errors keep their message", () => {
    expect(errorBody(409, "conflict", "some seats are no longer available").message).toBe(
      "conflict: some seats are no longer available",
    );
    expect(errorBody(404, "store_error", "entity not found: seat inventory")).toEqual({
      error: "store_error",
      message: "store error: entity not found: seat inventory",
    });
    expect(errorBody(503, "service_unavailable", "provider 'momo' is not enabled").message).toBe(
      "service unavailable: provider 'momo' is not enabled",
    );
  });

  // validator_errors_are_human_readable
  it("validator errors are human readable", () => {
    const issues = new Issues();
    issues.email("contact email", "not-an-email");
    expect(() => issues.throwIfAny()).toThrow("contact email must be a valid email address");
    try {
      issues.throwIfAny();
    } catch (e) {
      expect(
        errorBody((e as ApiError).status, (e as ApiError).code, (e as ApiError).message),
      ).toEqual({
        error: "validation_error",
        message: "validation failed: contact email must be a valid email address",
      });
    }
  });
});

describe("kinds and display prefixes (AppError::kind / Display)", () => {
  it.each([
    [400, "validation_error", "validation failed: x"],
    [400, "bad_request", "bad request: x"],
    [401, "unauthorized", "unauthorized: x"],
    [403, "forbidden", "forbidden: missing permission: x"],
    [404, "not_found", "resource not found: x"],
    [409, "conflict", "conflict: x"],
    [410, "gone", "resource gone: x"],
    [429, "too_many_requests", "too many requests: x"],
    [503, "service_unavailable", "service unavailable: x"],
  ])("%i %s", (status, kind, message) => {
    expect(errorBody(status, kind, "x")).toEqual({ error: kind, message });
  });

  it("derives the kind from the status for the port's older codes", () => {
    expect(errorKind(400, "validation")).toBe("validation_error");
    expect(errorKind(400, "bad-json")).toBe("bad_request");
    expect(errorKind(404, "not-found")).toBe("not_found");
    expect(errorKind(401, "invalid-credentials")).toBe("unauthorized");
    expect(errorKind(413, "too-large")).toBe("bad_request");
    expect(errorKind(502, "realtime-error")).toBe("internal_error");
  });
});

describe("route helpers", () => {
  it("err() answers the envelope with Retry-After on 429", async () => {
    const res = err(429, "too_many_requests", "slow down", 12.2);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("13");
    expect(await res.json()).toEqual({
      error: "too_many_requests",
      message: "too many requests: slow down",
    });
  });

  it("handleRouteError maps ApiError and hides unexpected failures", async () => {
    const known = handleRouteError(new ApiError(404, "store_error", "entity not found: user 1"));
    expect(known.status).toBe(404);
    expect(await known.json()).toEqual({
      error: "store_error",
      message: "store error: entity not found: user 1",
    });

    const unknown = handleRouteError(new Error("D1_ERROR: no such table: user at /srv/db"));
    expect(unknown.status).toBe(500);
    expect(await unknown.json()).toEqual({
      error: "internal_error",
      message: "internal server error",
    });
  });
});
