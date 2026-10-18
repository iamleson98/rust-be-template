// Seeds/updates the local D1 admin user to mirror the live login
// (email + password provided by the user for testing).
// Usage: bun scripts/seed-local-admin.ts
import { Database } from "bun:sqlite";
import { webcrypto } from "node:crypto";

const DB_PATH =
  "/home/z/my-project/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/82898e5c694c594f82d1cb27d406f7bc2576d96c3d76df608056d33d8cf32b89.sqlite";

const ITERATIONS = 100_000;
const KEY_LEN = 32;

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return Buffer.from(s, "binary").toString("base64");
}

async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  webcrypto.getRandomValues(salt);
  const key = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await webcrypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: ITERATIONS },
    key,
    KEY_LEN * 8,
  );
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(new Uint8Array(bits))}`;
}

const EMAIL = "${ADMIN_EMAIL}";
const PASSWORD = "${ADMIN_PASSWORD}";
const ID = crypto.randomUUID();

const db = new Database(DB_PATH);
const existing = db.query("SELECT id FROM user WHERE email = ?").get(EMAIL) as { id: string } | null;
const hash = await hashPassword(PASSWORD);
const now = new Date().toISOString();

if (existing) {
  db.run(
    "UPDATE user SET password_hash = ?, role = 'admin', status = 'active', full_name = ?, updated_at = ? WHERE id = ?",
    [hash, "Son Le Minh", now, existing.id],
  );
  console.log("updated admin", existing.id);
} else {
  db.run(
    `INSERT INTO user (id, brand_id, full_name, email, phone, email_verified_at, phone_verified_at, status,
       block_reason, password_hash, avatar_url, locale, is_guest, role, failed_login_attempts, locked_until,
       last_login_at, last_login_ip, password_changed_at, created_at, updated_at, oauth_provider, oauth_subject, is_bot)
     VALUES (?, NULL, ?, ?, NULL, NULL, NULL, 'active', NULL, ?, NULL, 'vi', 0, 'admin', 0, NULL, NULL, NULL, NULL, ?, ?, NULL, NULL, 0)`,
    [ID, "Son Le Minh", EMAIL, hash, now, now],
  );
  console.log("created admin", ID);
}

// also grant admin role row if the tables exist
try {
  const roleRow = db.query("SELECT id FROM role WHERE name = 'admin'").get() as { id: string } | null;
  const userRow = (db.query("SELECT id FROM user WHERE email = ?").get(EMAIL) as { id: string }).id;
  if (roleRow) {
    db.run(
      "INSERT OR IGNORE INTO user_role (id, user_id, role_id, assigned_at) VALUES (?, ?, ?, ?)",
      [crypto.randomUUID(), userRow, roleRow.id, now],
    );
    console.log("role row granted");
  }
} catch (e) {
  console.log("role tables skip:", String(e));
}
db.close();
