import { describe, expect, it } from "vitest";
import { CallSessions, type PickAgent } from "@/lib/calls/sessions";

const NOBODY = { name: null, avatar: null };
const T0 = 1_000_000;

/** Picks the first online agent that is not excluded. */
function picker(...online: string[]): PickAgent {
  return (exclude) => online.find((a) => !exclude.has(a)) ?? null;
}

function ringing(m: CallSessions, customer = "c1", pick = picker("a1", "a2"), conn = "cc1") {
  return m.beginCustomerOffer(customer, { sdp: "offer" }, "ch", conn, NOBODY, pick, T0);
}

describe("offers", () => {
  it("rings the picked agent and records the offer", () => {
    const m = new CallSessions();
    expect(ringing(m)).toEqual({ kind: "ringing", agentId: "a1" });
    expect(m.get("c1")).toMatchObject({ agentId: "a1", state: "ringing", rang: ["a1"] });
  });

  it("refuses a second call from the same customer", () => {
    const m = new CallSessions();
    ringing(m);
    expect(ringing(m)).toEqual({ kind: "customer-busy" });
  });

  it("skips agents who are already ringing or on a call", () => {
    const m = new CallSessions();
    ringing(m, "c1");
    expect(ringing(m, "c2")).toEqual({ kind: "ringing", agentId: "a2" });
    expect(ringing(m, "c3")).toEqual({ kind: "no-agent" });
  });

  it("an agent can call a free customer, but not twice, and not a busy customer", () => {
    const m = new CallSessions();
    expect(m.beginAgentOffer("a1", "c1", {}, null, "ac", NOBODY, T0)).toMatchObject({
      kind: "ringing",
    });
    expect(m.beginAgentOffer("a1", "c2", {}, null, "ac", NOBODY, T0)).toEqual({
      kind: "agent-busy",
    });
    expect(m.beginAgentOffer("a2", "c1", {}, null, "ac", NOBODY, T0)).toEqual({
      kind: "peer-busy",
    });
  });
});

describe("answering", () => {
  it("promotes only the ringing pair, once", () => {
    const m = new CallSessions();
    ringing(m);
    expect(m.onAnswer("a2", "c1", "x", T0)).toBeNull(); // wrong agent
    expect(m.onAnswer("a1", "c1", "ac1", T0 + 5)).toMatchObject({ state: "active" });
    expect(m.onAnswer("a1", "c1", "ac1", T0 + 6)).toBeNull(); // duplicate / late
    expect(m.get("c1")).toMatchObject({ answeredConn: "ac1", answeredAt: T0 + 5 });
  });

  it("routes only between the paired parties", () => {
    const m = new CallSessions();
    ringing(m);
    expect(m.agentFor("c1")).toBe("a1");
    expect(m.agentTarget("a1", "c1")).toBe("c1");
    expect(m.agentTarget("a2", "c1")).toBeNull();
    expect(m.agentFor("nobody")).toBeNull();
  });
});

describe("hangups and escalation", () => {
  it("a declined ring escalates to the next agent, never back to one already rung", () => {
    const m = new CallSessions();
    const pick = picker("a1", "a2");
    ringing(m, "c1", pick);
    expect(m.onAgentHangup("a1", "declined", pick, T0 + 10)).toEqual({
      kind: "rerouted",
      customerId: "c1",
      agentId: "a2",
    });
    expect(m.get("c1")).toMatchObject({
      agentId: "a2",
      rang: ["a1", "a2"],
      ringStartedAt: T0 + 10,
    });
    // a2 declines too: nobody left, the customer is told why.
    expect(m.onAgentHangup("a2", "busy", pick, T0 + 20)).toEqual({
      kind: "notify",
      customerId: "c1",
      reason: "busy",
    });
    expect(m.size).toBe(0);
  });

  it("an agent ending an ACTIVE call just ends it", () => {
    const m = new CallSessions();
    const pick = picker("a1", "a2");
    ringing(m, "c1", pick);
    m.onAnswer("a1", "c1", "ac", T0);
    expect(m.onAgentHangup("a1", "remote", pick, T0 + 1)).toEqual({
      kind: "notify",
      customerId: "c1",
      reason: "remote",
    });
  });

  it("an agent cancelling their own outbound offer is not re-routed", () => {
    const m = new CallSessions();
    m.beginAgentOffer("a1", "c1", {}, null, "ac", NOBODY, T0);
    expect(m.onAgentHangup("a1", "remote", picker("a2"), T0)).toMatchObject({ kind: "notify" });
  });

  it("the customer hanging up frees the agent and says whether it was answered", () => {
    const m = new CallSessions();
    ringing(m);
    expect(m.onCustomerHangup("c1")).toEqual({
      kind: "notify-agent",
      agentId: "a1",
      wasActive: false,
    });
    expect(m.onCustomerHangup("c1")).toEqual({ kind: "none" });
    expect(m.agentBusy("a1")).toBe(false);
  });
});

describe("sockets: multi-device, drop, resume", () => {
  function answered() {
    const m = new CallSessions();
    ringing(m, "c1", picker("a1"), "cust-sock-1");
    m.onAnswer("a1", "c1", "agent-sock-9", T0);
    return m;
  }

  it("only the sockets that carry the call can end it", () => {
    const m = answered();
    expect(m.socketCarriesActiveCall("a1", "agent-sock-9")).toBe(true);
    // The agent's phone is a second device that never answered: its drop is harmless.
    expect(m.socketCarriesActiveCall("a1", "agent-sock-other")).toBe(false);
    expect(m.endSessionsOfSocket("a1", "agent-sock-other")).toEqual([]);
    expect(m.size).toBe(1);
  });

  it("a ringing call is carried by the offerer only", () => {
    const m = new CallSessions();
    ringing(m, "c1", picker("a1"), "cust-sock-1");
    expect(m.socketCarriesCall("c1", "cust-sock-1")).toBe(true);
    expect(m.socketCarriesCall("a1", "agent-sock-9")).toBe(false);
  });

  it("a resumed call survives its OLD socket's late drop", () => {
    const m = answered();
    // The agent's phone switches network: a new socket resumes the call.
    expect(m.resumeOnSocket("a1", "agent-sock-11")).toBe(true);
    expect(m.endSessionsOfSocket("a1", "agent-sock-9")).toEqual([]);
    expect(m.size).toBe(1);
    // The customer resumes too.
    expect(m.resumeOnSocket("c1", "cust-sock-2")).toBe(true);
    expect(m.endSessionsOfSocket("c1", "cust-sock-1")).toEqual([]);
    // The new sockets now carry it: dropping one ends the call and names the peer.
    expect(m.endSessionsOfSocket("a1", "agent-sock-11")).toEqual([
      { customerId: "c1", agentId: "a1", droppedUserId: "a1", notifyUserId: "c1" },
    ]);
  });

  it("nothing to resume without a call", () => {
    expect(new CallSessions().resumeOnSocket("a1", "s")).toBe(false);
  });

  it("an answered call gets a grace window; a resume cancels it, silence ends it", () => {
    const m = answered();
    expect(m.startGrace("a1", "agent-sock-9", T0 + 15_000)).toBe(1);
    expect(m.endExpiredGrace(T0 + 14_000)).toEqual([]);

    m.resumeOnSocket("a1", "agent-sock-11");
    expect(m.get("c1")?.graceUntil).toBeNull();
    expect(m.endExpiredGrace(T0 + 60_000)).toEqual([]);

    m.startGrace("a1", "agent-sock-11", T0 + 15_000);
    expect(m.endExpiredGrace(T0 + 15_000)).toEqual([
      { customerId: "c1", agentId: "a1", droppedUserId: "a1", notifyUserId: "c1" },
    ]);
    expect(m.size).toBe(0);
  });

  it("a ringing call gets no grace: the caller vanished", () => {
    const m = new CallSessions();
    ringing(m, "c1", picker("a1"), "cust-sock-1");
    expect(m.startGrace("c1", "cust-sock-1", T0 + 15_000)).toBe(0);
  });
});

describe("janitor", () => {
  it("finds rings past their window and calls past the maximum length", () => {
    const m = new CallSessions();
    const pick = picker("a1", "a2");
    ringing(m, "c1", pick);
    ringing(m, "c2", pick);
    m.onAnswer("a2", "c2", "s", T0);
    expect(m.ringExpired(T0 + 59_999, 60_000)).toEqual([]);
    expect(m.ringExpired(T0 + 60_000, 60_000).map((s) => s.customerId)).toEqual(["c1"]);
    expect(m.overlong(T0 + 7_200_000, 7_200_000).map((s) => s.customerId)).toEqual(["c2"]);
  });

  it("reports the earliest deadline for the alarm", () => {
    const m = new CallSessions();
    expect(m.nextDeadline(60_000, 7_200_000)).toBeNull();
    ringing(m, "c1", picker("a1", "a2"));
    expect(m.nextDeadline(60_000, 7_200_000)).toBe(T0 + 60_000);
    m.onAnswer("a1", "c1", "s", T0);
    expect(m.nextDeadline(60_000, 7_200_000)).toBe(T0 + 7_200_000);
    m.startGrace("a1", "s", T0 + 15_000);
    expect(m.nextDeadline(60_000, 7_200_000)).toBe(T0 + 15_000);
  });

  it("round-trips through a snapshot (Durable Object storage)", () => {
    const m = new CallSessions();
    ringing(m, "c1", picker("a1"));
    m.onAnswer("a1", "c1", "s", T0);
    const restored = new CallSessions(JSON.parse(JSON.stringify(m.snapshot())));
    expect(restored.get("c1")).toEqual(m.get("c1"));
    expect(restored.agentBusy("a1")).toBe(true);
  });
});
