/**
 * Account operations behind the auth routes — the port of Rust
 * `service/auth_service.rs`: register, credential check, password change and
 * the OAuth user upsert. Routes validate the body, call these, and answer with
 * `authResponse`; every rule (limits, error text, status) lives here once.
 */
import { and, count, eq, inArray, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { clientIp } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { normalizePhone } from "@/lib/format";
import { hashPassword, needsRehash, verifyPassword } from "./password";
import { assertNotLocked, recordFailedLogin } from "./lockout";
import { ApiError, assignRole } from "./rbac";
import { revokeAllSessions } from "./session";
import { Issues, asObject, byteLength, isEmail, str } from "./validation";

export type UserRow = typeof users.$inferSelect;

/** `nullclaw::NULLCLAW_BOT_EMAIL` — the support bot that staffs the chat when no human is online. */
export const NULLCLAW_BOT_EMAIL = "nullclaw_agent@example.com";

/** Rust `AppError::Unauthorized("invalid credentials")`. */
const invalidCredentials = () => new ApiError(401, "unauthorized", "invalid credentials");

// ── Lookups ─────────────────────────────────────────────────────────────

async function userById(id: string): Promise<UserRow | undefined> {
  const db = await getDb();
  return (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
}

/**
 * Rust looks emails up exactly as typed. Accounts made here are stored in
 * lower case, so an exact match comes first and the lower-cased form second:
 * a Rust account "Ann@Mail.com" still signs in with what it registered, and a
 * port account with whatever case the person types.
 */
export async function findUserByEmail(email: string): Promise<UserRow | undefined> {
  const lower = email.toLowerCase();
  const db = await getDb();
  const rows = await db
    .select()
    .from(users)
    .where(inArray(users.email, lower === email ? [email] : [email, lower]));
  return rows.find((u) => u.email === email) ?? rows[0];
}

/** Phone sign-in (port feature): the stored number in any common spelling, or a legacy phone-as-email row. */
async function findUserByPhone(phone: string): Promise<UserRow | undefined> {
  const db = await getDb();
  const spellings = [...new Set([phone, normalizePhone(phone)])];
  const rows = await db
    .select()
    .from(users)
    .where(or(inArray(users.phone, spellings), inArray(users.email, spellings)))
    .limit(2);
  // A number that two accounts claim identifies nobody.
  return rows.length === 1 ? rows[0] : undefined;
}

async function humanUserCount(): Promise<number> {
  const db = await getDb();
  const rows = await db.select({ n: count() }).from(users).where(eq(users.isBot, false));
  return rows[0]?.n ?? 0;
}

// ── Register ────────────────────────────────────────────────────────────

export interface RegisterInput {
  fullName: string;
  /** Lower-cased; `""` when the person signed up with a phone only. */
  email: string;
  phone: string | null;
  password: string;
  locale: "vi" | "en";
}

/**
 * Rust `RegisterRequest` (`routes/auth.rs`) followed by the checks
 * `AuthService::register` repeats on what it receives (those count bytes).
 */
export function parseRegister(raw: unknown): RegisterInput {
  const body = asObject(raw);
  const fullName = str(body, "fullName");
  const email = str(body, "email");
  const phone = str(body, "phone");
  const password = str(body, "password");

  const issues = new Issues();
  if (fullName === undefined) issues.add("full name", "invalid");
  else issues.length("full name", fullName, 1, 128);
  if (email !== undefined) {
    issues.email("email", email);
    issues.length("email", email, 0, 255);
  }
  if (phone !== undefined) {
    issues.length("phone", phone, 0, 20);
    issues.phone("phone", phone);
  }
  if (password === undefined) issues.add("password", "invalid");
  else issues.length("password", password, 8, 128);
  issues.throwIfAny();

  const contact = email || phone;
  if (!contact) throw new ApiError(400, "validation_error", "Email or phone is required");
  if (email && !isEmail(email)) throw new ApiError(400, "validation_error", "invalid email");
  const nameBytes = byteLength(fullName!);
  if (nameBytes < 3 || nameBytes > 64) {
    throw new ApiError(400, "validation_error", "username must be 3-64 characters");
  }
  const passwordBytes = byteLength(password!);
  if (passwordBytes < 8 || passwordBytes > 128) {
    throw new ApiError(400, "validation_error", "password must be 8-128 characters");
  }
  return {
    fullName: fullName!,
    email: email ? email.toLowerCase() : "",
    phone: phone ? normalizePhone(phone) : null,
    password: password!,
    locale: body.locale === "en" ? "en" : "vi",
  };
}

/** Rust `AuthService::ensure_bot_account` on first signup: the support bot, an `employee` flagged `is_bot`. */
async function createBotAccount(): Promise<void> {
  try {
    const db = await getDb();
    const id = crypto.randomUUID();
    await db.insert(users).values({
      id,
      email: NULLCLAW_BOT_EMAIL,
      fullName: "nullclaw_agent",
      // Not a hash: the bot can never sign in.
      passwordHash: "hashed_password",
      role: "employee",
      isBot: true,
    });
    await assignRole(id, "employee");
  } catch (e) {
    // Non-fatal: chat degrades gracefully without the bot row.
    console.warn("[auth] could not create the NullClaw bot account", e);
  }
}

/** A unique-key violation of the user table (email, phone-as-email or OAuth identity). */
function isUniqueViolation(e: unknown): boolean {
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(String((e as Error)?.cause ?? e));
}

/**
 * Rust `AuthService::register`. The first HUMAN account becomes `admin` (the
 * bot never counts); everyone else is a `user`. A phone-only signup keeps the
 * phone in the email column too, as Rust did, so the unique email key still
 * identifies the account.
 */
export async function registerUser(input: RegisterInput): Promise<UserRow> {
  const db = await getDb();
  const identity = input.email || input.phone!;
  if (input.email && (await emailTaken(input.email))) {
    throw new ApiError(409, "conflict", "email already registered");
  }
  if (input.phone && (await phoneTaken(input.phone))) {
    throw new ApiError(409, "conflict", "phone already registered");
  }

  const isFirst = (await humanUserCount()) === 0;
  const role = isFirst ? "admin" : "user";
  const id = crypto.randomUUID();
  try {
    await db.insert(users).values({
      id,
      fullName: input.fullName,
      email: identity,
      phone: input.phone,
      passwordHash: await hashPassword(input.password),
      role,
      status: "active",
      locale: input.locale,
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ApiError(409, "conflict", "account already registered");
    throw e;
  }
  if (isFirst) await createBotAccount();
  await assignRole(id, role);
  return (await userById(id))!;
}

async function emailTaken(email: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .limit(1);
  return rows.length > 0;
}

async function phoneTaken(phone: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.phone, phone), eq(users.email, phone)))
    .limit(1);
  return rows.length > 0;
}

// ── Login ───────────────────────────────────────────────────────────────

export interface LoginInput {
  /** Exactly what was typed; Rust matches it as is. */
  email: string;
  /** Port feature: sign in with the number given at registration. */
  phone: string;
  password: string;
}

/**
 * Rust `LoginRequest`: a valid email ≤ 255 chars and a password of 1–255
 * chars. The port also accepts a phone instead of the email.
 */
export function parseLogin(raw: unknown): LoginInput {
  const body = asObject(raw);
  const email = (str(body, "email") ?? "").trim();
  const phone = (str(body, "phone") ?? "").trim();
  const password = str(body, "password");

  const issues = new Issues();
  if (email) {
    issues.email("email", email);
    issues.length("email", email, 0, 255);
  } else if (phone) {
    issues.phone("phone", phone);
  } else {
    issues.add("email", "email");
  }
  if (password === undefined) issues.add("password", "invalid");
  else issues.length("password", password, 1, 255);
  issues.throwIfAny();
  return { email, phone, password: password! };
}

/**
 * Rust `AuthService::login` plus the port's password-guessing defences (the
 * per-account rate limit and the D1 lockout, neither exists in Rust). A wrong
 * email and a wrong password are the same 401; an account that is not active
 * is only reported to someone who knew its password.
 */
export async function authenticate(req: Request, input: LoginInput): Promise<UserRow> {
  // Brake per account being tried — before any DB or hashing work, so a
  // flood against one login (existing or not) is cheap to refuse.
  await rateLimit("AUTH", "login", (input.email || input.phone).toLowerCase());

  const user = input.email
    ? await findUserByEmail(input.email)
    : await findUserByPhone(input.phone);
  if (!user?.passwordHash) throw invalidCredentials();

  assertNotLocked(user);
  if (!(await verifyPassword(input.password, user.passwordHash))) {
    await recordFailedLogin(user.id);
    throw invalidCredentials();
  }
  if (user.status !== "active") {
    throw new ApiError(403, "forbidden", user.blockReason ?? "account is not active");
  }

  // Imported Argon2id (or weaker-PBKDF2) hashes upgrade to the current
  // format now that the plaintext is in hand.
  const db = await getDb();
  await db
    .update(users)
    .set({
      ...(needsRehash(user.passwordHash)
        ? { passwordHash: await hashPassword(input.password) }
        : {}),
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date().toISOString(),
      lastLoginIp: clientIp(req),
    })
    .where(eq(users.id, user.id));
  return user;
}

// ── Password change ─────────────────────────────────────────────────────

export interface PasswordChange {
  currentPassword: string | null;
  newPassword: string;
}

/** Rust `ChangePasswordRequest`: current ≤ 255 chars (optional), new 8–128. */
export function parsePasswordChange(raw: unknown): PasswordChange {
  const body = asObject(raw);
  const current = body.currentPassword;
  const next = str(body, "newPassword");

  const issues = new Issues();
  if (typeof current === "string") issues.length("current password", current, 0, 255);
  else if (current !== undefined && current !== null) issues.add("current password", "invalid");
  if (next === undefined) issues.add("new password", "invalid");
  else issues.length("new password", next, 8, 128);
  issues.throwIfAny();
  return { currentPassword: typeof current === "string" ? current : null, newPassword: next! };
}

/**
 * Rust `AuthService::change_password`: the current password must match (an
 * account made through Google/Facebook has none and sets its first), and every
 * refresh token of the user is revoked — the caller gets a fresh session. A
 * wrong current password is a 400, not a 401, so it never ends the session.
 */
export async function changePassword(userId: string, change: PasswordChange): Promise<UserRow> {
  const user = await userById(userId);
  if (!user) throw new ApiError(404, "store_error", `entity not found: user ${userId}`);
  if (user.passwordHash) {
    const ok =
      change.currentPassword !== null &&
      (await verifyPassword(change.currentPassword, user.passwordHash));
    if (!ok) throw new ApiError(400, "bad_request", "current password is incorrect");
  }
  const now = new Date().toISOString();
  const db = await getDb();
  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(change.newPassword),
      failedLoginAttempts: 0,
      lockedUntil: null,
      passwordChangedAt: now,
      updatedAt: now,
    })
    .where(eq(users.id, userId));
  await revokeAllSessions(userId);
  return (await userById(userId))!;
}

// ── OAuth ───────────────────────────────────────────────────────────────

export interface OAuthProfile {
  provider: string;
  subject: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

/**
 * Rust `AuthService::register_oauth_user` / `UserStore::upsert_oauth_user`:
 * the `(provider, subject)` identity wins; otherwise an account with the same
 * email is linked to it; otherwise a new, verified, password-less account is
 * created (first human → admin, as in `registerUser`).
 */
export async function registerOauthUser(profile: OAuthProfile): Promise<UserRow> {
  const db = await getDb();
  const byIdentity = (
    await db
      .select()
      .from(users)
      .where(
        and(eq(users.oauthProvider, profile.provider), eq(users.oauthSubject, profile.subject)),
      )
      .limit(1)
  )[0];
  if (byIdentity) return byIdentity;

  const byEmail = await findUserByEmail(profile.email);
  if (byEmail) {
    await db
      .update(users)
      .set({
        oauthProvider: profile.provider,
        oauthSubject: profile.subject,
        ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, byEmail.id));
    return (await userById(byEmail.id))!;
  }

  const role = (await humanUserCount()) === 0 ? "admin" : "user";
  const id = crypto.randomUUID();
  try {
    await db.insert(users).values({
      id,
      fullName: profile.name,
      email: profile.email,
      emailVerifiedAt: new Date().toISOString(),
      avatarUrl: profile.avatarUrl,
      role,
      oauthProvider: profile.provider,
      oauthSubject: profile.subject,
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ApiError(409, "store_error", "conflict: account exists");
    throw e;
  }
  await assignRole(id, role);
  return (await userById(id))!;
}
