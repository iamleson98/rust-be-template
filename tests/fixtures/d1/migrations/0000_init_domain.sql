CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_type` text,
	`actor_id` text,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`metadata` text,
	`ip` text,
	`user_agent` text,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_actor` ON `audit_log` (`actor_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_target` ON `audit_log` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_created` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `notification` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text,
	`body` text,
	`data` text,
	`read` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_notif_user` ON `notification` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_notif_user_read` ON `notification` (`user_id`,`read`);--> statement-breakpoint
CREATE TABLE `permissions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_perms_name` ON `permissions` (`name`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`updated_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_posts_author` ON `posts` (`author_id`);--> statement-breakpoint
CREATE INDEX `idx_posts_created` ON `posts` (`created_at`);--> statement-breakpoint
CREATE TABLE `push_device` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`platform` text DEFAULT 'android' NOT NULL,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`updated_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`last_seen_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_push_user` ON `push_device` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_push_user_token` ON `push_device` (`user_id`,`token`);--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`issued_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`expires_at` text NOT NULL,
	`revoked` integer DEFAULT false NOT NULL,
	`user_agent` text,
	`ip` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_refresh_token_hash` ON `refresh_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_refresh_user` ON `refresh_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role_id` text NOT NULL,
	`permission_id` text NOT NULL,
	`assigned_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_role_perms_role` ON `role_permissions` (`role_id`);--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_roles_name` ON `roles` (`name`);--> statement-breakpoint
CREATE TABLE `staff_presence_state` (
	`user_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`brand_id` text,
	`online` integer DEFAULT false NOT NULL,
	`last_seen_at` text NOT NULL,
	`last_online_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_roles` (
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`assigned_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_user_roles_user` ON `user_roles` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_user_roles_role` ON `user_roles` (`role_id`);--> statement-breakpoint
CREATE TABLE `user_verification` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`channel` text NOT NULL,
	`target` text NOT NULL,
	`code_hash` text NOT NULL,
	`purpose` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_uv_target` ON `user_verification` (`target`,`purpose`);--> statement-breakpoint
CREATE INDEX `idx_uv_user` ON `user_verification` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text,
	`full_name` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text,
	`email_verified_at` text,
	`phone_verified_at` text,
	`status` text DEFAULT 'active' NOT NULL,
	`block_reason` text,
	`password_hash` text,
	`avatar_url` text,
	`locale` text DEFAULT 'vi' NOT NULL,
	`is_guest` integer DEFAULT false NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`failed_login_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`last_login_at` text,
	`last_login_ip` text,
	`password_changed_at` text,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`updated_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`oauth_provider` text,
	`oauth_subject` text,
	`is_bot` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_email` ON `user` (`email`);--> statement-breakpoint
CREATE INDEX `idx_user_status` ON `user` (`status`);--> statement-breakpoint
CREATE INDEX `idx_user_brand` ON `user` (`brand_id`);--> statement-breakpoint
CREATE INDEX `idx_user_created` ON `user` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_oauth` ON `user` (`oauth_provider`,`oauth_subject`);--> statement-breakpoint
CREATE TABLE `brand` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`logo_url` text,
	`description` text,
	`contact_phone` text,
	`contact_email` text,
	`rating` real,
	`status` text DEFAULT 'active' NOT NULL,
	`total_trips` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`updated_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`child_max_age` integer,
	`child_discount_amount` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_brand_slug` ON `brand` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_brand_created` ON `brand` (`created_at`);--> statement-breakpoint
CREATE TABLE `address` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`lat` real,
	`lon` real,
	`province` text,
	`district` text,
	`ward` text,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`updated_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_address_brand` ON `address` (`brand_id`);--> statement-breakpoint
CREATE INDEX `idx_address_geo` ON `address` (`lat`,`lon`);--> statement-breakpoint
CREATE TABLE `bus_layout` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text,
	`name` text,
	`vehicle_type` text,
	`total_seats` integer,
	`layout_data` text,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`updated_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_layout_brand` ON `bus_layout` (`brand_id`);--> statement-breakpoint
CREATE TABLE `pickup_point` (
	`id` text PRIMARY KEY NOT NULL,
	`route_id` text NOT NULL,
	`name` text,
	`address` text,
	`lat` real,
	`lon` real,
	`stop_order` integer DEFAULT 0 NOT NULL,
	`kind` text,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	FOREIGN KEY (`route_id`) REFERENCES `route`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_pickup_route` ON `pickup_point` (`route_id`);--> statement-breakpoint
CREATE INDEX `idx_pickup_route_order` ON `pickup_point` (`route_id`,`stop_order`);--> statement-breakpoint
CREATE INDEX `idx_pickup_geo` ON `pickup_point` (`lat`,`lon`);--> statement-breakpoint
CREATE TABLE `place` (
	`id` text PRIMARY KEY NOT NULL,
	`osm_id` integer,
	`name` text NOT NULL,
	`name_ascii` text,
	`name_no_tones` text,
	`type` text NOT NULL,
	`province` text,
	`district` text,
	`ward` text,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`population` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_place_osm` ON `place` (`osm_id`);--> statement-breakpoint
CREATE INDEX `idx_place_province` ON `place` (`province`);--> statement-breakpoint
CREATE INDEX `idx_place_type` ON `place` (`type`);--> statement-breakpoint
CREATE INDEX `idx_place_no_tones` ON `place` (`name_no_tones`);--> statement-breakpoint
CREATE TABLE `route_picture` (
	`id` text PRIMARY KEY NOT NULL,
	`route_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`storage_key` text NOT NULL,
	`thumb_key` text,
	`content_hash` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`thumb_bytes` integer,
	`width` integer,
	`height` integer,
	`alt_text` text,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`updated_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	FOREIGN KEY (`route_id`) REFERENCES `route`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_rp_route_order` ON `route_picture` (`route_id`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_rp_route_hash` ON `route_picture` (`route_id`,`content_hash`);--> statement-breakpoint
CREATE TABLE `route` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text,
	`name` text NOT NULL,
	`start_location_id` text NOT NULL,
	`end_location_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`updated_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_route_brand` ON `route` (`brand_id`);--> statement-breakpoint
CREATE INDEX `idx_route_endpoints` ON `route` (`start_location_id`,`end_location_id`);--> statement-breakpoint
CREATE INDEX `idx_route_status` ON `route` (`status`);--> statement-breakpoint
CREATE INDEX `idx_route_created` ON `route` (`created_at`);--> statement-breakpoint
CREATE TABLE `schedule_fare` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`seat_class` text NOT NULL,
	`price_adult` integer NOT NULL,
	`price_child` integer,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`updated_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedule`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sf_schedule_class` ON `schedule_fare` (`schedule_id`,`seat_class`);--> statement-breakpoint
CREATE TABLE `schedule_point` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`address_id` text NOT NULL,
	`stop_order` integer DEFAULT 0 NOT NULL,
	`kind` text NOT NULL,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`arrival_time` text,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedule`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`address_id`) REFERENCES `address`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sp_schedule` ON `schedule_point` (`schedule_id`);--> statement-breakpoint
CREATE INDEX `idx_sp_address` ON `schedule_point` (`address_id`);--> statement-breakpoint
CREATE TABLE `schedule` (
	`id` text PRIMARY KEY NOT NULL,
	`route_id` text NOT NULL,
	`departure_time` text NOT NULL,
	`effective_from` text,
	`effective_to` text,
	`days_of_week` text,
	`bus_layout_id` text,
	`base_price_adult` integer DEFAULT 0 NOT NULL,
	`base_price_child` integer,
	`amenities` text,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`vehicle_type_id` text,
	FOREIGN KEY (`route_id`) REFERENCES `route`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bus_layout_id`) REFERENCES `bus_layout`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`vehicle_type_id`) REFERENCES `vehicle_type`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_schedule_route` ON `schedule` (`route_id`);--> statement-breakpoint
CREATE INDEX `idx_schedule_route_time` ON `schedule` (`route_id`,`departure_time`);--> statement-breakpoint
CREATE INDEX `idx_schedule_effective` ON `schedule` (`effective_from`,`effective_to`);--> statement-breakpoint
CREATE INDEX `idx_schedule_vt` ON `schedule` (`vehicle_type_id`);--> statement-breakpoint
CREATE TABLE `seat` (
	`id` text PRIMARY KEY NOT NULL,
	`bus_layout_id` text NOT NULL,
	`seat_label` text NOT NULL,
	`seat_class` text,
	`row_num` integer,
	`col_num` integer,
	`is_window` integer DEFAULT false NOT NULL,
	`floor` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	FOREIGN KEY (`bus_layout_id`) REFERENCES `bus_layout`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_seat_layout` ON `seat` (`bus_layout_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_seat_layout_label` ON `seat` (`bus_layout_id`,`seat_label`);--> statement-breakpoint
CREATE TABLE `vehicle_type` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`total_seats` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`updated_at` text DEFAULT '(datetime(''now''))' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_vt_code` ON `vehicle_type` (`code`);--> statement-breakpoint
CREATE TABLE `booking_seat` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_id` text NOT NULL,
	`seat_id` text NOT NULL,
	`passenger_name` text,
	`passenger_age` integer,
	`passenger_type` text,
	`price` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	FOREIGN KEY (`booking_id`) REFERENCES `booking`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`seat_id`) REFERENCES `seat`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_bs_booking` ON `booking_seat` (`booking_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_bs_booking_seat` ON `booking_seat` (`booking_id`,`seat_id`);--> statement-breakpoint
CREATE TABLE `booking` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`user_id` text,
	`guest_name` text,
	`guest_phone` text,
	`guest_email` text,
	`trip_session_id` text NOT NULL,
	`boarding_point_id` text,
	`dropping_point_id` text,
	`adult_count` integer DEFAULT 1 NOT NULL,
	`child_count` integer DEFAULT 0 NOT NULL,
	`subtotal` integer DEFAULT 0 NOT NULL,
	`discount` integer DEFAULT 0 NOT NULL,
	`fees` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'VND' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payment_method` text,
	`campaign_applied_id` text,
	`expires_at` text,
	`contact_name` text,
	`contact_phone` text,
	`contact_email` text,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`updated_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`pickup_name` text,
	`pickup_address` text,
	`pickup_lat` text,
	`pickup_lon` text,
	`dropoff_name` text,
	`dropoff_address` text,
	`dropoff_lat` text,
	`dropoff_lon` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`trip_session_id`) REFERENCES `trip_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`boarding_point_id`) REFERENCES `pickup_point`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`dropping_point_id`) REFERENCES `pickup_point`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_booking_code` ON `booking` (`code`);--> statement-breakpoint
CREATE INDEX `idx_booking_status_created` ON `booking` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_booking_user` ON `booking` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `campaign` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text,
	`code` text NOT NULL,
	`discount_type` text NOT NULL,
	`discount_value` integer NOT NULL,
	`max_uses` integer,
	`used_count` integer DEFAULT 0 NOT NULL,
	`starts_at` text,
	`ends_at` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`updated_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_campaign_code` ON `campaign` (`code`);--> statement-breakpoint
CREATE INDEX `idx_campaign_brand` ON `campaign` (`brand_id`);--> statement-breakpoint
CREATE INDEX `idx_campaign_status` ON `campaign` (`status`);--> statement-breakpoint
CREATE TABLE `coupon` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`campaign_id` text NOT NULL,
	`tier_id` text NOT NULL,
	`user_id` text,
	`amount` integer NOT NULL,
	`status` text NOT NULL,
	`active_holder` text,
	`valid_until` text,
	`booking_id` text,
	`brand_id` text,
	`claim_ip` text,
	`claimed_at` text NOT NULL,
	`reserved_at` text,
	`redeemed_at` text,
	`settled_at` text,
	`settled_by` text,
	`settlement_note` text,
	`updated_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `discount_campaign`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tier_id`) REFERENCES `discount_tier`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`booking_id`) REFERENCES `booking`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_coupon_user` ON `coupon` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_coupon_status` ON `coupon` (`status`);--> statement-breakpoint
CREATE TABLE `discount_campaign_brand` (
	`campaign_id` text NOT NULL,
	`brand_id` text NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `discount_campaign`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_dcb` ON `discount_campaign_brand` (`campaign_id`,`brand_id`);--> statement-breakpoint
CREATE TABLE `discount_campaign` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`coupon_validity` text NOT NULL,
	`all_brands` integer DEFAULT true NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`created_by` text,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`updated_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_dc_window` ON `discount_campaign` (`starts_at`,`ends_at`);--> statement-breakpoint
CREATE TABLE `discount_program` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text,
	`name` text NOT NULL,
	`description` text,
	`discount_type` text NOT NULL,
	`discount_value` integer NOT NULL,
	`starts_at` text,
	`ends_at` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_dp_brand` ON `discount_program` (`brand_id`);--> statement-breakpoint
CREATE INDEX `idx_dp_status` ON `discount_program` (`status`);--> statement-breakpoint
CREATE TABLE `discount_tier` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`amount` integer NOT NULL,
	`total_slots` integer NOT NULL,
	`claimed_slots` integer DEFAULT 0 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `discount_campaign`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_dt_campaign` ON `discount_tier` (`campaign_id`);--> statement-breakpoint
CREATE TABLE `payment` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_id` text NOT NULL,
	`user_id` text,
	`provider` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'VND' NOT NULL,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`updated_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`provider_txn_ref` text,
	`provider_trans_id` text,
	`gateway_url` text,
	`qr_payload` text,
	`memo` text,
	`provider_response` text,
	`failure_reason` text,
	`created_by` text,
	`collected_at` text,
	`collected_by` text,
	FOREIGN KEY (`booking_id`) REFERENCES `booking`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payment_txn_ref` ON `payment` (`provider_txn_ref`);--> statement-breakpoint
CREATE INDEX `idx_payment_booking` ON `payment` (`booking_id`);--> statement-breakpoint
CREATE INDEX `idx_payment_status` ON `payment` (`status`);--> statement-breakpoint
CREATE TABLE `review` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_id` text,
	`trip_session_id` text,
	`route_id` text,
	`brand_id` text,
	`user_id` text,
	`author_name` text,
	`author_phone` text,
	`rating` integer NOT NULL,
	`title` text,
	`content` text,
	`tags` text,
	`photos` text,
	`status` text DEFAULT 'published' NOT NULL,
	`helpful_count` integer DEFAULT 0 NOT NULL,
	`reply` text,
	`replied_at` text,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`updated_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	FOREIGN KEY (`trip_session_id`) REFERENCES `trip_session`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`route_id`) REFERENCES `route`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_review_created` ON `review` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_review_brand` ON `review` (`brand_id`);--> statement-breakpoint
CREATE INDEX `idx_review_route` ON `review` (`route_id`);--> statement-breakpoint
CREATE TABLE `seat_inventory` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_session_id` text NOT NULL,
	`seat_id` text NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`base_price` integer DEFAULT 0 NOT NULL,
	`final_price` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'VND' NOT NULL,
	`held_until` text,
	`held_by_booking_id` text,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`updated_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	FOREIGN KEY (`trip_session_id`) REFERENCES `trip_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`seat_id`) REFERENCES `seat`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_si_trip` ON `seat_inventory` (`trip_session_id`);--> statement-breakpoint
CREATE INDEX `idx_si_seat` ON `seat_inventory` (`seat_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_si_trip_seat` ON `seat_inventory` (`trip_session_id`,`seat_id`);--> statement-breakpoint
CREATE INDEX `idx_si_held_until` ON `seat_inventory` (`held_until`);--> statement-breakpoint
CREATE TABLE `trip_session` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`departure_date` text NOT NULL,
	`actual_departure_at` text,
	`driver_name` text,
	`driver_phone` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`total_seats` integer DEFAULT 0 NOT NULL,
	`available_seats` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`updated_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedule`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_trip_schedule` ON `trip_session` (`schedule_id`);--> statement-breakpoint
CREATE INDEX `idx_trip_date` ON `trip_session` (`departure_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_trip_schedule_date` ON `trip_session` (`schedule_id`,`departure_date`);--> statement-breakpoint
CREATE INDEX `idx_trip_date_status` ON `trip_session` (`departure_date`,`status`);--> statement-breakpoint
CREATE TABLE `chat_assignment` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`employee_id` text,
	`assigned_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`unassigned_at` text,
	FOREIGN KEY (`channel_id`) REFERENCES `chat_channel`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_ca_channel` ON `chat_assignment` (`channel_id`);--> statement-breakpoint
CREATE INDEX `idx_ca_employee` ON `chat_assignment` (`employee_id`);--> statement-breakpoint
CREATE TABLE `chat_channel_member` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`joined_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`left_at` text,
	FOREIGN KEY (`channel_id`) REFERENCES `chat_channel`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ccm_channel` ON `chat_channel_member` (`channel_id`);--> statement-breakpoint
CREATE INDEX `idx_ccm_user` ON `chat_channel_member` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ccm_pair` ON `chat_channel_member` (`channel_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `chat_channel` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`brand_id` text,
	`topic` text,
	`status` text DEFAULT 'open' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`last_message_at` text,
	`last_message_preview` text,
	`unread_user` integer DEFAULT 0 NOT NULL,
	`unread_employee` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`closed_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_chat_user` ON `chat_channel` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_chat_status` ON `chat_channel` (`status`);--> statement-breakpoint
CREATE TABLE `chat_message` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`sender_type` text NOT NULL,
	`sender_id` text,
	`content` text,
	`kind` text DEFAULT 'text' NOT NULL,
	`attachments` text,
	`status` text DEFAULT 'sent' NOT NULL,
	`client_msg_id` text,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `chat_channel`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_cm_channel_created` ON `chat_message` (`channel_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_cm_sender` ON `chat_message` (`sender_type`,`channel_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cm_channel_client` ON `chat_message` (`channel_id`,`client_msg_id`);--> statement-breakpoint
CREATE TABLE `nullclaw_exchange` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text,
	`user_message_id` text,
	`assistant_message_id` text,
	`prompt` text,
	`completion` text,
	`model` text,
	`latency_ms` integer,
	`handoff_to_human` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `chat_channel`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_nx_channel` ON `nullclaw_exchange` (`channel_id`);--> statement-breakpoint
CREATE TABLE `ad_conversion` (
	`id` text PRIMARY KEY NOT NULL,
	`event` text NOT NULL,
	`transaction_id` text NOT NULL,
	`conversion_value` text,
	`currency` text,
	`gclid` text,
	`wbraid` text,
	`gbraid` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`uploaded_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ad_event_txn` ON `ad_conversion` (`event`,`transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_ad_status_created` ON `ad_conversion` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `background_job` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`args` text DEFAULT '{}' NOT NULL,
	`state` text DEFAULT 'available' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`run_at` text NOT NULL,
	`locked_by` text,
	`locked_until` text,
	`unique_key` text,
	`last_error` text,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`updated_at` text DEFAULT '(datetime(''now''))' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_bj_state_runat` ON `background_job` (`state`,`run_at`);--> statement-breakpoint
CREATE INDEX `idx_bj_kind_key` ON `background_job` (`kind`,`unique_key`);--> statement-breakpoint
CREATE TABLE `job_run` (
	`id` text PRIMARY KEY NOT NULL,
	`job_type` text NOT NULL,
	`status` text NOT NULL,
	`detail` text,
	`error` text,
	`started_at` text,
	`finished_at` text,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_jr_type_created` ON `job_run` (`job_type`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_jr_status` ON `job_run` (`status`);--> statement-breakpoint
CREATE TABLE `price_alert` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`email` text,
	`from_name` text,
	`to_name` text,
	`route_id` text,
	`target_price` integer,
	`frequency` text DEFAULT 'daily' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`expires_at` text,
	`last_triggered_at` text,
	`user_id` text,
	FOREIGN KEY (`route_id`) REFERENCES `route`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_pa_phone` ON `price_alert` (`phone`);--> statement-breakpoint
CREATE TABLE `scheduled_job` (
	`id` text PRIMARY KEY NOT NULL,
	`job_type` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`interval_days` integer DEFAULT 1 NOT NULL,
	`at_hour` integer DEFAULT 0 NOT NULL,
	`at_minute` integer DEFAULT 0 NOT NULL,
	`next_run_at` text,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`updated_at` text DEFAULT '(datetime(''now''))' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sj_type` ON `scheduled_job` (`job_type`);