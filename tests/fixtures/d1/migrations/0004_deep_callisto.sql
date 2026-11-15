--> Source: drizzle-kit generate (coupon unique indexes, Rust `m20261011_000020` parity)
-- Self-heal rows written by the pre-parity code paths so the unique
-- indexes can be created on an existing database:
--  1. active_holder must be NULL unless the coupon is held/reserved
--     (older code left it set on expired/redeemed rows);
--  2. one claim per (campaign, user): keep the newest row, drop dups
--     (only possible via direct DB edits).
UPDATE coupon SET active_holder = NULL, updated_at = datetime('now')
WHERE active_holder IS NOT NULL AND status NOT IN ('held', 'reserved');--> statement-breakpoint
DELETE FROM coupon WHERE user_id IS NOT NULL AND id NOT IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY campaign_id, user_id ORDER BY claimed_at DESC, id
    ) AS rn FROM coupon WHERE user_id IS NOT NULL
  ) WHERE rn = 1
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_coupon_code` ON `coupon` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_coupon_active_holder` ON `coupon` (`active_holder`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_coupon_campaign_user` ON `coupon` (`campaign_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_coupon_booking` ON `coupon` (`booking_id`);
