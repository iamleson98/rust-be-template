/**
 * Jobs schema — scheduled jobs (cron), job runs (history) and the
 * background job queue. Ported from _000009_create_engagement_jobs
 * and _000019_create_background_job.
 *
 * On Cloudflare the cron DRIVER lives in the container (cloudflare/container),
 * which ticks every minute and calls POST /api/jobs/tick with a service token.
 * D1 remains the durable registry + history.
 */
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { routes } from "./catalog";
import { users } from "./auth";

export const scheduledJobs = sqliteTable(
  "scheduled_job",
  {
    id: text("id").primaryKey(),
    jobType: text("job_type").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    intervalDays: integer("interval_days").notNull().default(1),
    atHour: integer("at_hour").notNull().default(0),
    atMinute: integer("at_minute").notNull().default(0),
    nextRunAt: text("next_run_at"),
    createdAt: text("created_at").notNull().default("(datetime('now'))"),
    updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
  },
  (t) => [uniqueIndex("idx_sj_type").on(t.jobType)],
);

export const jobRuns = sqliteTable(
  "job_run",
  {
    id: text("id").primaryKey(),
    jobType: text("job_type").notNull(),
    status: text("status").notNull(), // queued|running|succeeded|failed|cancelled|interrupted
    detail: text("detail"),
    error: text("error"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at").notNull().default("(datetime('now'))"),
  },
  (t) => [
    index("idx_jr_type_created").on(t.jobType, t.createdAt),
    index("idx_jr_status").on(t.status),
  ],
);

export const backgroundJobs = sqliteTable(
  "background_job",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    args: text("args").notNull().default("{}"),
    state: text("state").notNull().default("available"), // available|running|dead|cancelled
    priority: integer("priority").notNull().default(0),
    attempt: integer("attempt").notNull().default(0),
    runAt: text("run_at").notNull(),
    lockedBy: text("locked_by"),
    lockedUntil: text("locked_until"),
    uniqueKey: text("unique_key"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull().default("(datetime('now'))"),
    updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
  },
  (t) => [
    index("idx_bj_state_runat").on(t.state, t.runAt),
    index("idx_bj_kind_key").on(t.kind, t.uniqueKey),
  ],
);

export const adConversions = sqliteTable(
  "ad_conversion",
  {
    id: text("id").primaryKey(),
    event: text("event").notNull(),
    transactionId: text("transaction_id").notNull(),
    conversionValue: text("conversion_value"),
    currency: text("currency"),
    gclid: text("gclid"),
    wbraid: text("wbraid"),
    gbraid: text("gbraid"),
    status: text("status").notNull().default("pending"),
    createdAt: text("created_at").notNull().default("(datetime('now'))"),
    uploadedAt: text("uploaded_at"),
  },
  (t) => [
    uniqueIndex("idx_ad_event_txn").on(t.event, t.transactionId),
    index("idx_ad_status_created").on(t.status, t.createdAt),
  ],
);

export const priceAlerts = sqliteTable(
  "price_alert",
  {
    id: text("id").primaryKey(),
    phone: text("phone").notNull(),
    email: text("email"),
    fromName: text("from_name"),
    toName: text("to_name"),
    routeId: text("route_id").references(() => routes.id, { onDelete: "set null" }),
    targetPrice: integer("target_price"),
    frequency: text("frequency").notNull().default("daily"),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull().default("(datetime('now'))"),
    expiresAt: text("expires_at"),
    lastTriggeredAt: text("last_triggered_at"),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("idx_pa_phone").on(t.phone)],
);
