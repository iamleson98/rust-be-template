-- 0005: repair rows that stored the literal text "(datetime('now'))".
-- The 0000 defaults were baked as a quoted string, not an expression, so any
-- insert that omitted a timestamp stored that text (it sorts before every
-- real date and made `created_at < datetime('now','-30 days')` true for all
-- rows). The schema now supplies ISO timestamps app-side ($defaultFn); this
-- rewrites the damaged rows to the migration instant — the true insert time
-- is unrecoverable. Column defaults themselves are left alone: changing them
-- would rebuild ~46 tables, and no insert path relies on them any more.
-- meta/0005_snapshot.json is aligned to the schema (no SQL default), so
-- `drizzle-kit generate` stays a no-op instead of proposing that rebuild.

UPDATE `audit_log` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `notification` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `permissions` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `posts` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `posts` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `updated_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `push_device` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `push_device` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `updated_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `refresh_tokens` SET `issued_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `issued_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `role_permissions` SET `assigned_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `assigned_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `roles` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `user_roles` SET `assigned_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `assigned_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `user` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `user` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `updated_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `brand` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `brand` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `updated_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `address` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `address` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `updated_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `bus_layout` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `bus_layout` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `updated_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `pickup_point` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `place` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `route_picture` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `route_picture` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `updated_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `route` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `route` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `updated_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `schedule_fare` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `schedule_fare` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `updated_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `schedule_point` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `schedule` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `seat` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `vehicle_type` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `vehicle_type` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `updated_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `booking_seat` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `booking` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `booking` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `updated_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `campaign` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `campaign` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `updated_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `coupon` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `updated_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `discount_campaign` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `discount_campaign` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `updated_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `discount_program` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `discount_tier` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `payment` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `payment` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `updated_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `review` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `review` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `updated_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `seat_inventory` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `seat_inventory` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `updated_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `trip_session` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `trip_session` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `updated_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `chat_assignment` SET `assigned_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `assigned_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `chat_channel_member` SET `joined_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `joined_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `chat_channel` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `chat_message` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `nullclaw_exchange` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `ad_conversion` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `background_job` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `background_job` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `updated_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `job_run` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `price_alert` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `scheduled_job` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `scheduled_job` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `updated_at` = '(datetime(''now''))';
