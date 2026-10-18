import { beforeAll, describe, expect, it } from "vitest";
import migration0 from "../../migrations/0000_init_domain.sql?raw";
import migration1 from "../../migrations/0001_fts_and_seeds.sql?raw";
import migration2 from "../../migrations/0002_realtime_meeting_id.sql?raw";
import { applyMigrations } from "../helpers/migrate";
import { getDb, getD1, atomicBatch, rawAll, sqlIn } from "@/lib/db/client";
import { users, chatChannels } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * D1 integration tests — the schema is the REAL migration chain, applied
 * exactly like `wrangler d1 migrations apply` does, and every query runs
 * through the production helpers against a real D1 (miniflare) database.
 */
beforeAll(async () => {
  await applyMigrations(migration0, migration1, migration2);
});

const now = new Date().toISOString();

describe("atomicBatch — typed builders and raw SQL in one D1 transaction", () => {
  it("applies builders and raw statements together", async () => {
    const db = await getDb();
    const userId = crypto.randomUUID();
    const results = await atomicBatch([
      db.insert(users).values({ id: userId, fullName: "Batch User", email: "batch@test.vn", createdAt: now, updatedAt: now }),
      sql`UPDATE "user" SET locale = 'en' WHERE id = ${userId}`,
    ]);
    expect(results).toHaveLength(2);
    const row = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
    expect(row?.fullName).toBe("Batch User");
    expect(row?.locale).toBe("en"); // raw statement landed in the same batch
  });

  it("rolls everything back when any statement fails (single transaction)", async () => {
    const db = await getDb();
    const userId = crypto.randomUUID();
    await expect(
      atomicBatch([
        db.insert(users).values({ id: userId, fullName: "Doomed", email: "doomed@test.vn", createdAt: now, updatedAt: now }),
        sql`UPDATE "user" SET nonexistent_column = 'x' WHERE id = ${userId}`,
      ]),
    ).rejects.toThrow();
    const row = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
    expect(row).toBeUndefined(); // first statement was rolled back with the second
  });

  it("supports onConflictDoNothing builders (chat member upsert pattern)", async () => {
    const db = await getDb();
    const userId = crypto.randomUUID();
    const channelId = crypto.randomUUID();
    await atomicBatch([
      db.insert(users).values({ id: userId, fullName: "Chatter", email: "chatter@test.vn", createdAt: now, updatedAt: now }),
      db
        .insert(chatChannels)
        .values({ id: channelId, userId, topic: "help", createdAt: now, realtimeMeetingId: null }),
    ]);
    // Same values again → ON CONFLICT DO NOTHING instead of a UNIQUE failure
    await expect(
      atomicBatch([
        db
          .insert(chatChannels)
          .values({ id: channelId, userId, topic: "help", createdAt: now, realtimeMeetingId: null })
          .onConflictDoNothing(),
      ]),
    ).resolves.toBeDefined();
    const count = await rawAll<{ n: number }>(sql`SELECT COUNT(*) AS n FROM chat_channel WHERE id = ${channelId}`);
    expect(Number(count[0]?.n)).toBe(1);
  });
});

describe("sqlIn", () => {
  it("binds every value as a parameter", async () => {
    const ids = ["a", "b", "c"];
    const rows = await rawAll<{ id: string }>(
      sql`SELECT id FROM (SELECT 'a' AS id UNION SELECT 'b' UNION SELECT 'z') t WHERE id IN (${sqlIn(ids)})`,
    );
    expect(rows.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("degenerates to NULL for an empty list (matches no row)", async () => {
    const rows = await rawAll<{ id: string }>(
      sql`SELECT id FROM (SELECT 'a' AS id) t WHERE id IN (${sqlIn([])})`,
    );
    expect(rows).toHaveLength(0);
  });
});

describe("migrations", () => {
  it("created the chat_channel realtime_meeting_id column (0002)", async () => {
    const cols = await rawAll<{ name: string }>(sql`PRAGMA table_info('chat_channel')`);
    expect(cols.map((c) => c.name)).toContain("realtime_meeting_id");
  });

  it("created the FTS5 virtual table with diacritic-insensitive tokenizer (0001)", async () => {
    const tables = await rawAll<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE name = 'place_fts'`);
    expect(tables).toHaveLength(1);
    const ddl = await rawAll<{ sql: string }>(sql`SELECT sql FROM sqlite_master WHERE name = 'place_fts'`);
    expect(ddl[0]?.sql).toContain("remove_diacritics");
  });
});
