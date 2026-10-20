import { beforeAll, describe, expect, it } from "vitest";
import migration0 from "../../migrations/0000_init_domain.sql?raw";
import migration5 from "../../migrations/0005_repair_literal_timestamps.sql?raw";
import { setCloudflareContext } from "../helpers/context";
import { applyMigrations } from "../helpers/migrate";
import { getDb } from "@/lib/db/client";
import { jobRuns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { env } from "cloudflare:test";

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

beforeAll(async () => {
  setCloudflareContext();
  await applyMigrations(migration0);
});

describe("timestamp defaults", () => {
  it("builder inserts that omit created_at store a real ISO instant, not the literal default", async () => {
    const db = await getDb();
    await db.insert(jobRuns).values({ id: "ts-builder", jobType: "t", status: "succeeded" });
    const row = (await db.select().from(jobRuns).where(eq(jobRuns.id, "ts-builder")))[0];
    expect(row?.createdAt).toMatch(ISO);
  });

  it("migration 0005 rewrites rows that stored the literal default", async () => {
    // A raw insert is what the pre-fix code paths effectively did: the DB
    // default is the quoted literal text.
    await env.DB.prepare(
      `INSERT INTO job_run (id, job_type, status) VALUES ('ts-legacy', 't', 'ok')`,
    ).run();
    const before = await env.DB.prepare(
      `SELECT created_at FROM job_run WHERE id = 'ts-legacy'`,
    ).first<{
      created_at: string;
    }>();
    expect(before?.created_at).toBe("(datetime('now'))");

    await applyMigrations(migration5);

    const after = await env.DB.prepare(
      `SELECT created_at FROM job_run WHERE id = 'ts-legacy'`,
    ).first<{
      created_at: string;
    }>();
    expect(after?.created_at).toMatch(ISO);
  });
});
