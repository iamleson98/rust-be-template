import { describe, expect, it } from "vitest";
import {
  availabilityCmp,
  botActive,
  pickBestAvailable,
  servesBrand,
  staffPresenceFrame,
  type StaffEntry,
} from "@/lib/chat/presence";

const staff = (over: Partial<StaffEntry> & { userId: string }): StaffEntry => ({
  name: over.userId,
  role: "employee",
  brandId: null,
  online: true,
  inCall: false,
  activeChats: 0,
  lastAssignedAt: null,
  lastSeenAt: "2026-10-28T00:00:00.000Z",
  ...over,
});

describe("who gets the next chat (Rust presence::pick_best_available)", () => {
  it("prefers the lowest chat load", () => {
    const picked = pickBestAvailable(
      [staff({ userId: "a", activeChats: 3 }), staff({ userId: "b", activeChats: 1 })],
      null,
    );
    expect(picked?.userId).toBe("b");
  });

  it("alternates between equals: the one picked longest ago wins, never-picked first", () => {
    const a = staff({ userId: "a", lastAssignedAt: 200 });
    const b = staff({ userId: "b", lastAssignedAt: 100 });
    const c = staff({ userId: "c", lastAssignedAt: null });
    expect(pickBestAvailable([a, b, c], null)?.userId).toBe("c");
    expect(pickBestAvailable([a, b], null)?.userId).toBe("b");
  });

  it("prefers an employee over an admin at equal load, then the name", () => {
    expect(
      pickBestAvailable(
        [staff({ userId: "z-admin", role: "admin" }), staff({ userId: "y", name: "Y" })],
        null,
      )?.userId,
    ).toBe("y");
    expect(
      availabilityCmp(staff({ userId: "a", name: "An" }), staff({ userId: "b", name: "Bình" })),
    ).toBeLessThan(0);
  });

  it("skips staff in a call or offline, but a loaded one stays reachable", () => {
    expect(
      pickBestAvailable(
        [
          staff({ userId: "call", inCall: true }),
          staff({ userId: "gone", online: false }),
          staff({ userId: "busy", activeChats: 9 }),
        ],
        null,
      )?.userId,
    ).toBe("busy");
    expect(pickBestAvailable([staff({ userId: "call", inCall: true })], null)).toBeNull();
  });

  it("scopes by brand: global staff serve every brand, brand staff only theirs", () => {
    const global = staff({ userId: "g" });
    const mine = staff({ userId: "m", brandId: "brand-a" });
    expect(servesBrand(global, "brand-b")).toBe(true);
    expect(servesBrand(mine, "brand-b")).toBe(false);
    expect(servesBrand(mine, null)).toBe(true);
    expect(pickBestAvailable([mine], "brand-b")).toBeNull();
  });
});

describe("the bot", () => {
  it("answers only while nobody at all is online", () => {
    expect(botActive([], null)).toBe(true);
    expect(botActive([staff({ userId: "a", online: false })], null)).toBe(true);
    expect(botActive([staff({ userId: "a", inCall: true })], null)).toBe(false);
  });
});

describe("staff_presence frame", () => {
  it("lists online staff first, then by name, with counts", () => {
    const frame = staffPresenceFrame(
      [
        staff({ userId: "b", name: "Bình" }),
        staff({ userId: "a", name: "An", inCall: true }),
        staff({ userId: "c", name: "Chi", online: false }),
      ],
      null,
    );
    expect(frame.staff.map((s) => s.userId)).toEqual(["a", "b", "c"]);
    expect(frame).toMatchObject({ onlineCount: 2, availableCount: 1, botActive: false });
    expect(frame.staff[0]).toMatchObject({ busy: true, inCall: true, available: false });
  });
});
