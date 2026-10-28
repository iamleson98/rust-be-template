import { describe, expect, it } from "vitest";
import { summarize } from "@/lib/cron";

describe("cron summary", () => {
  it("says so when nothing was due", () => {
    expect(summarize([])).toBe("nothing due");
  });

  it("lists every job with its outcome and the error of a failed one", () => {
    expect(
      summarize([
        { jobType: "holds.sweep", status: "succeeded" },
        { jobType: "coupons.expire", status: "failed", error: "D1 down" },
      ]),
    ).toBe("holds.sweep=succeeded coupons.expire=failed(D1 down)");
  });
});
