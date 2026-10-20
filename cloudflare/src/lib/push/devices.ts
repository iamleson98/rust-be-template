/** Push device tokens (`push_device`), per user. Raw D1 so the call hub can use it. */

export interface PushDevice {
  token: string;
  platform: string;
}

const PLATFORMS = new Set(["ios", "android", "web"]);

export const normalizePlatform = (p: string | undefined): string => {
  const v = (p ?? "").trim().toLowerCase();
  return PLATFORMS.has(v) ? v : "android";
};

/** Idempotent: a known (user, token) pair only refreshes its timestamps. */
export async function upsertDevice(
  db: D1Database,
  userId: string,
  token: string,
  platform: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO push_device (id, user_id, token, platform, created_at, updated_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, token) DO UPDATE SET
         platform = excluded.platform, updated_at = excluded.updated_at,
         last_seen_at = excluded.last_seen_at`,
    )
    .bind(crypto.randomUUID(), userId, token, platform, now, now, now)
    .run();
}

/** Scoped to the owner: one user must not unregister another's device by guessing a token. */
export async function deleteDeviceForUser(
  db: D1Database,
  userId: string,
  token: string,
): Promise<number> {
  const r = await db
    .prepare(`DELETE FROM push_device WHERE user_id = ? AND token = ?`)
    .bind(userId, token)
    .run();
  return r.meta.changes ?? 0;
}

export async function listDevices(db: D1Database, userId: string): Promise<PushDevice[]> {
  const { results } = await db
    .prepare(`SELECT token, platform FROM push_device WHERE user_id = ?`)
    .bind(userId)
    .all<PushDevice>();
  return results ?? [];
}

export async function deleteDeviceByToken(db: D1Database, token: string): Promise<void> {
  await db.prepare(`DELETE FROM push_device WHERE token = ?`).bind(token).run();
}
