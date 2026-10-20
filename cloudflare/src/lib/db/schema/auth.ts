/**
 * Auth / users / RBAC schema — ported from SeaORM migrations
 * m20260905_000001_create_users_auth + _000002_create_rbac (+ later adds).
 *
 * Conventions ported from the Rust backend:
 *  - IDs are UUID strings.
 *  - Timestamps are ISO-8601 UTC TEXT (JSON-friendly).
 *  - Money is integer VND.
 */
import { isoNow } from "./now";
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id"),
    fullName: text("full_name").notNull(),
    email: text("email").notNull().default(""),
    phone: text("phone"),
    emailVerifiedAt: text("email_verified_at"),
    phoneVerifiedAt: text("phone_verified_at"),
    status: text("status").notNull().default("active"),
    blockReason: text("block_reason"),
    passwordHash: text("password_hash"),
    avatarUrl: text("avatar_url"),
    locale: text("locale").notNull().default("vi"),
    isGuest: integer("is_guest", { mode: "boolean" }).notNull().default(false),
    role: text("role").notNull().default("user"), // user | employee | admin
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    lockedUntil: text("locked_until"),
    lastLoginAt: text("last_login_at"),
    lastLoginIp: text("last_login_ip"),
    passwordChangedAt: text("password_changed_at"),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
    updatedAt: text("updated_at").notNull().$defaultFn(isoNow),
    oauthProvider: text("oauth_provider"),
    oauthSubject: text("oauth_subject"),
    isBot: integer("is_bot", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    uniqueIndex("idx_user_email").on(t.email),
    index("idx_user_status").on(t.status),
    index("idx_user_brand").on(t.brandId),
    index("idx_user_created").on(t.createdAt),
    uniqueIndex("idx_user_oauth").on(t.oauthProvider, t.oauthSubject),
  ],
);

export const posts = sqliteTable(
  "posts",
  {
    id: text("id").primaryKey(),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
    updatedAt: text("updated_at").notNull().$defaultFn(isoNow),
  },
  (t) => [index("idx_posts_author").on(t.authorId), index("idx_posts_created").on(t.createdAt)],
);

export const refreshTokens = sqliteTable(
  "refresh_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    issuedAt: text("issued_at").notNull().$defaultFn(isoNow),
    expiresAt: text("expires_at").notNull(),
    revoked: integer("revoked", { mode: "boolean" }).notNull().default(false),
    userAgent: text("user_agent"),
    ip: text("ip"),
  },
  (t) => [index("idx_refresh_token_hash").on(t.tokenHash), index("idx_refresh_user").on(t.userId)],
);

export const userVerification = sqliteTable(
  "user_verification",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(), // email | sms
    target: text("target").notNull(),
    codeHash: text("code_hash").notNull(),
    purpose: text("purpose").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
  },
  (t) => [index("idx_uv_target").on(t.target, t.purpose), index("idx_uv_user").on(t.userId)],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    actorType: text("actor_type"),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: text("metadata"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
  },
  (t) => [
    index("idx_audit_actor").on(t.actorId),
    index("idx_audit_target").on(t.targetType, t.targetId),
    index("idx_audit_created").on(t.createdAt),
  ],
);

export const notifications = sqliteTable(
  "notification",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title"),
    body: text("body"),
    data: text("data"),
    read: integer("read", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
  },
  (t) => [index("idx_notif_user").on(t.userId), index("idx_notif_user_read").on(t.userId, t.read)],
);

export const roles = sqliteTable(
  "roles",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
  },
  (t) => [uniqueIndex("idx_roles_name").on(t.name)],
);

export const permissions = sqliteTable(
  "permissions",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
  },
  (t) => [uniqueIndex("idx_perms_name").on(t.name)],
);

export const userRoles = sqliteTable(
  "user_roles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    assignedAt: text("assigned_at").notNull().$defaultFn(isoNow),
  },
  (t) => [index("idx_user_roles_user").on(t.userId), index("idx_user_roles_role").on(t.roleId)],
);

export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: text("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
    assignedAt: text("assigned_at").notNull().$defaultFn(isoNow),
  },
  (t) => [index("idx_role_perms_role").on(t.roleId)],
);

export const pushDevices = sqliteTable(
  "push_device",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    platform: text("platform").notNull().default("android"),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
    updatedAt: text("updated_at").notNull().$defaultFn(isoNow),
    lastSeenAt: text("last_seen_at"),
  },
  (t) => [
    index("idx_push_user").on(t.userId),
    uniqueIndex("idx_push_user_token").on(t.userId, t.token),
  ],
);

export const staffPresenceState = sqliteTable("staff_presence_state", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  role: text("role").notNull(),
  brandId: text("brand_id"),
  online: integer("online", { mode: "boolean" }).notNull().default(false),
  lastSeenAt: text("last_seen_at").notNull(),
  lastOnlineAt: text("last_online_at"),
});
