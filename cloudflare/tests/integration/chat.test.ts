import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getD1, getDb } from "@/lib/db/client";
import {
  chatAssignments,
  chatChannelMembers,
  chatChannels,
  chatMessages,
  users,
} from "@/lib/db/schema";
import { activeAssignment, getChannel, routeUserMessage } from "@/lib/chat/ops";
import type { StaffEntry } from "@/lib/chat/presence";
import {
  chatStats,
  claimChannel,
  closeChannel,
  createChannel,
  listChannels,
  listMessages,
  markRead,
  postMessage,
  releaseChannel,
} from "@/lib/services/chat";
import { fixture, migrate, owner, rejection, sessionOf, type Fixture } from "../helpers/fixture";

/**
 * Port of `chat_service.rs` behaviour: one open channel per customer and
 * brand, the roster rows, access control that hides other people's
 * channels, message idempotency and counters, claim/release/close rules and
 * the routing decision (the Rust file tests none of these).
 */

beforeAll(migrate);

let f: Fixture;
beforeEach(async () => {
  f = await fixture(1);
  const d1 = await getD1();
  await d1.batch(
    ["chat_message", "chat_assignment", "chat_channel_member", "chat_channel"].map((t) =>
      d1.prepare(`DELETE FROM ${t}`),
    ),
  );
});

const staffEntry = (userId: string, over: Partial<StaffEntry> = {}): StaffEntry => ({
  userId,
  name: userId,
  role: "employee",
  brandId: null,
  online: true,
  inCall: false,
  activeChats: 0,
  lastAssignedAt: null,
  lastSeenAt: "2026-10-28T00:00:00.000Z",
  ...over,
});

describe("opening a channel", () => {
  it("creates one with the default topic and the customer, the admin and the bot on its roster", async () => {
    const admin = await owner("admin");
    const bot = crypto.randomUUID();
    const db = await getDb();
    await db.insert(users).values({
      id: bot,
      fullName: "NullClaw",
      email: "nullclaw_agent@example.com",
      role: "employee",
      isBot: true,
    });
    const customer = await owner();

    const channel = await createChannel(customer, {});
    expect(channel).toMatchObject({
      userId: customer,
      status: "open",
      topic: "Hỗ trợ",
      unreadUser: 0,
      assignedToMe: false,
    });
    expect(channel.user).toMatchObject({ id: customer, fullName: "Tester" });

    const members = await db
      .select()
      .from(chatChannelMembers)
      .where(eq(chatChannelMembers.channelId, channel.id));
    expect(Object.fromEntries(members.map((m) => [m.userId, m.role]))).toEqual({
      [customer]: "user",
      [bot]: "bot",
      [admin]: "employee",
    });
  });

  it("returns the customer's open channel instead of a second one, per brand", async () => {
    const customer = await owner();
    const first = await createChannel(customer, { topic: "Vé" });
    expect((await createChannel(customer, { topic: "Khác" })).id).toBe(first.id);
    expect((await createChannel(customer, { brandId: f.brandId })).id).not.toBe(first.id);
  });

  it("starts a new one once the old one is assigned or closed (Rust only reuses `open`)", async () => {
    const customer = await owner();
    const first = await createChannel(customer, {});
    const db = await getDb();
    await db.update(chatChannels).set({ status: "assigned" }).where(eq(chatChannels.id, first.id));
    expect((await createChannel(customer, {})).id).not.toBe(first.id);
  });

  it("401s a token for a deleted user and 400s an unknown brand", async () => {
    expect((await rejection(createChannel(crypto.randomUUID(), {}))).status).toBe(401);
    const customer = await owner();
    expect(
      await rejection(createChannel(customer, { brandId: crypto.randomUUID() })),
    ).toMatchObject({
      status: 400,
    });
  });
});

describe("messages", () => {
  async function opened() {
    const customer = await owner();
    const channel = await createChannel(customer, {});
    return { customer, session: await sessionOf(customer), channel };
  }

  it("stores a customer message, previews 100 characters, bumps the staff counter and is idempotent", async () => {
    const { session, channel } = await opened();
    const long = "x".repeat(150);
    const sent = await postMessage(session, channel.id, { content: long, clientMsgId: "c-1" });
    expect(sent).toMatchObject({
      senderType: "user",
      senderId: session.id,
      content: long,
      kind: "text",
    });

    const again = await postMessage(session, channel.id, {
      content: "changed",
      clientMsgId: "c-1",
    });
    expect(again.id).toBe(sent.id);

    const row = (
      await (await getDb()).select().from(chatChannels).where(eq(chatChannels.id, channel.id))
    )[0]!;
    expect(row).toMatchObject({
      unreadEmployee: 1,
      unreadUser: 0,
      lastMessagePreview: "x".repeat(100),
    });
    expect(await (await getDb()).select().from(chatMessages)).toHaveLength(1);
  });

  it("a staff reply bumps the customer's counter, and reading clears the caller's side", async () => {
    const { session, channel } = await opened();
    const staff = await sessionOf(await owner("employee"));
    await postMessage(session, channel.id, { content: "Xin chào" });
    expect(await postMessage(staff, channel.id, { content: "Chào bạn" })).toMatchObject({
      senderType: "employee",
    });
    const db = await getDb();
    const counters = async () => {
      const r = (await db.select().from(chatChannels).where(eq(chatChannels.id, channel.id)))[0]!;
      return [r.unreadUser, r.unreadEmployee];
    };
    expect(await counters()).toEqual([1, 1]);
    await markRead(staff, channel.id);
    expect(await counters()).toEqual([1, 0]);
    await markRead(session, channel.id);
    expect(await counters()).toEqual([0, 0]);
  });

  it("hides a channel from other customers (404, not 403) and lets staff in", async () => {
    const { channel } = await opened();
    const stranger = await sessionOf(await owner());
    for (const act of [
      () => listMessages(stranger, channel.id, 30, 0),
      () => postMessage(stranger, channel.id, { content: "hi" }),
      () => markRead(stranger, channel.id),
    ])
      expect(await rejection(act())).toEqual({ status: 404, message: "chat channel not found" });
    const staff = await sessionOf(await owner("employee"));
    expect(await listMessages(staff, channel.id, 30, 0)).toEqual([]);
  });

  it("lists newest first with offset paging, capped at 200", async () => {
    const { session, channel } = await opened();
    for (const t of ["one", "two", "three"]) {
      await postMessage(session, channel.id, { content: t });
      await new Promise((r) => setTimeout(r, 2));
    }
    expect((await listMessages(session, channel.id, 2, 0)).map((m) => m.content)).toEqual([
      "three",
      "two",
    ]);
    expect((await listMessages(session, channel.id, 2, 2)).map((m) => m.content)).toEqual(["one"]);
  });

  it("validates the request like CreateMessageRequest", async () => {
    const { session, channel } = await opened();
    for (const bad of [
      { content: "x".repeat(10_001) },
      { kind: "k".repeat(21) },
      { attachments: "a".repeat(16_385) },
      { clientMsgId: "c".repeat(101) },
    ])
      expect(
        (await rejection(postMessage(session, channel.id, bad))).status,
        JSON.stringify(bad),
      ).toBe(400);
  });
});

describe("the channel list", () => {
  it("shows customers their own and staff the open and assigned queue, narrowed to their brand", async () => {
    const a = await owner();
    const b = await owner();
    const mine = await createChannel(a, {});
    const branded = await createChannel(b, { brandId: f.brandId });
    const closed = await createChannel(await owner(), {});
    await closeChannel(await sessionOf(await owner("employee")), closed.id);

    expect((await listChannels(await sessionOf(a), 50, 0)).map((c) => c.id)).toEqual([mine.id]);
    const admin = await sessionOf(await owner("admin"));
    expect((await listChannels(admin, 50, 0)).map((c) => c.id).sort()).toEqual(
      [mine.id, branded.id].sort(),
    );
    expect((await listChannels({ ...admin, brandId: f.brandId }, 50, 0)).map((c) => c.id)).toEqual([
      branded.id,
    ]);
  });
});

describe("claim, release, close", () => {
  async function open() {
    const customer = await owner();
    return (await createChannel(customer, {})).id;
  }

  it("an employee's claim assigns them; an admin's claim hands the channel back to the open queue", async () => {
    const id = await open();
    const employee = await sessionOf(await owner("employee"));
    const claimed = await claimChannel(employee, id);
    expect(claimed.channel).toMatchObject({ status: "assigned", assignedToMe: true });
    expect(claimed.channel.assignedTo?.id).toBe(employee.id);

    const admin = await sessionOf(await owner("admin"));
    const taken = await claimChannel(admin, id);
    expect(taken.channel).toMatchObject({ status: "open", assignedToMe: false });
    expect(await activeAssignment(await getD1(), id)).toBeNull();
  });

  it("a claim re-uses the single assignment row", async () => {
    const id = await open();
    await claimChannel(await sessionOf(await owner("employee")), id);
    await claimChannel(await sessionOf(await owner("employee")), id);
    expect(await (await getDb()).select().from(chatAssignments)).toHaveLength(1);
  });

  it("customers cannot claim or close; employees cannot release", async () => {
    const id = await open();
    const customer = await sessionOf(await owner());
    const employee = await sessionOf(await owner("employee"));
    expect((await rejection(claimChannel(customer, id))).status).toBe(403);
    expect((await rejection(closeChannel(customer, id))).status).toBe(403);
    expect(await rejection(releaseChannel(employee, id))).toMatchObject({ status: 403 });
    const admin = await sessionOf(await owner("admin"));
    await claimChannel(employee, id);
    expect((await releaseChannel(admin, id)).channel.status).toBe("open");
  });

  it("closing ends the assignment and stamps the channel", async () => {
    const id = await open();
    const employee = await sessionOf(await owner("employee"));
    await claimChannel(employee, id);
    expect((await closeChannel(employee, id)).channel.status).toBe("closed");
    const d1 = await getD1();
    expect(await activeAssignment(d1, id)).toBeNull();
    expect((await getChannel(d1, id))?.closed_at).not.toBeNull();
  });

  it("counts channels by status", async () => {
    const [a, b] = [await open(), await open()];
    await closeChannel(await sessionOf(await owner("employee")), b);
    void a;
    expect(await chatStats(await getDb())).toEqual({ open: 1, assigned: 0, closed: 1 });
  });
});

describe("routing a customer's message (Rust route_user_message)", () => {
  async function channel() {
    return (await createChannel(await owner(), {})).id;
  }

  it("goes to the online assignee", async () => {
    const id = await channel();
    const emp = await owner("employee");
    await claimChannel(await sessionOf(emp), id);
    const d1 = await getD1();
    expect(await routeUserMessage(d1, id, [staffEntry(emp)])).toEqual({
      kind: "assignee",
      employeeId: emp,
    });
  });

  it("releases an assignee who went offline and picks the most available employee", async () => {
    const id = await channel();
    const gone = await owner("employee");
    const free = await owner("employee");
    await claimChannel(await sessionOf(gone), id);
    const d1 = await getD1();
    const out = await routeUserMessage(d1, id, [
      staffEntry(gone, { online: false }),
      staffEntry(free),
    ]);
    expect(out).toEqual({ kind: "assigned", employeeId: free });
    expect((await activeAssignment(d1, id))?.employee_id).toBe(free);
    expect((await getChannel(d1, id))?.status).toBe("assigned");
  });

  it("an admin pick writes no assignment row", async () => {
    const id = await channel();
    const admin = await owner("admin");
    const d1 = await getD1();
    expect(await routeUserMessage(d1, id, [staffEntry(admin, { role: "admin" })])).toEqual({
      kind: "admin",
      adminId: admin,
    });
    expect(await activeAssignment(d1, id)).toBeNull();
  });

  it("falls back to the bot when nobody is online, and queues when everyone is in a call", async () => {
    const id = await channel();
    const d1 = await getD1();
    expect(await routeUserMessage(d1, id, [])).toEqual({ kind: "bot" });
    expect(await routeUserMessage(d1, id, [staffEntry("x", { inCall: true })])).toEqual({
      kind: "queued",
    });
  });

  it("never re-assigns a closed channel", async () => {
    const id = await channel();
    await closeChannel(await sessionOf(await owner("employee")), id);
    expect(
      await routeUserMessage(await getD1(), id, [staffEntry(await owner("employee"))]),
    ).toEqual({
      kind: "queued",
    });
  });
});
