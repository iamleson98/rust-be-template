CREATE TABLE "address" ( "id" uuid_text NOT NULL PRIMARY KEY, "brand_id" uuid_text NOT NULL, "name" varchar(255) NOT NULL, "address" text NULL, "lat" double NOT NULL, "lon" double NOT NULL, "province" text NULL, "district" text NULL, "ward" text NULL, "created_at" text NOT NULL, "updated_at" text NOT NULL, FOREIGN KEY ("brand_id") REFERENCES "brand" ("id") ON DELETE CASCADE ON UPDATE CASCADE );

CREATE TABLE "audit_log" ( "id" uuid_text NOT NULL PRIMARY KEY, "actor_type" varchar(50) NULL, "actor_id" uuid_text NULL, "action" varchar(50) NOT NULL, "target_type" varchar(50) NULL, "target_id" uuid_text NULL, "metadata" text NULL, "ip" varchar(45) NULL, "user_agent" text NULL, "created_at" text NOT NULL );

CREATE TABLE "booking" ( "id" uuid_text NOT NULL PRIMARY KEY, "code" varchar(20) NOT NULL UNIQUE, "user_id" uuid_text NULL, "guest_name" varchar(255) NULL, "guest_phone" varchar(20) NULL, "guest_email" varchar(255) NULL, "trip_session_id" uuid_text NOT NULL, "boarding_point_id" uuid_text NULL, "dropping_point_id" uuid_text NULL, "adult_count" integer NOT NULL DEFAULT 1, "child_count" integer NOT NULL DEFAULT 0, "subtotal" integer NOT NULL DEFAULT 0, "discount" integer NOT NULL DEFAULT 0, "fees" integer NOT NULL DEFAULT 0, "total" integer NOT NULL DEFAULT 0, "currency" varchar(3) NOT NULL DEFAULT 'VND', "status" varchar(30) NOT NULL DEFAULT 'pending', "payment_method" varchar(30) NULL, "campaign_applied_id" uuid_text NULL, "expires_at" text NULL, "contact_name" varchar(255) NULL, "contact_phone" varchar(20) NULL, "contact_email" varchar(255) NULL, "created_at" text NOT NULL, "updated_at" text NOT NULL, "dropoff_address" text NULL, "dropoff_lat" double NULL, "dropoff_lon" double NULL, "dropoff_name" varchar(255) NULL, "pickup_address" text NULL, "pickup_lat" double NULL, "pickup_lon" double NULL, "pickup_name" varchar(255) NULL, FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE, FOREIGN KEY ("trip_session_id") REFERENCES "trip_session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE, FOREIGN KEY ("boarding_point_id") REFERENCES "pickup_point" ("id") ON DELETE SET NULL ON UPDATE CASCADE, FOREIGN KEY ("dropping_point_id") REFERENCES "pickup_point" ("id") ON DELETE SET NULL ON UPDATE CASCADE, FOREIGN KEY ("campaign_applied_id") REFERENCES "campaign" ("id") ON DELETE SET NULL ON UPDATE CASCADE );

CREATE TABLE "booking_seat" ( "id" uuid_text NOT NULL PRIMARY KEY, "booking_id" uuid_text NOT NULL, "seat_id" uuid_text NOT NULL, "passenger_name" varchar(255) NULL, "passenger_age" smallint NULL, "passenger_type" varchar(10) NULL, "price" integer NOT NULL DEFAULT 0, "created_at" text NOT NULL, FOREIGN KEY ("booking_id") REFERENCES "booking" ("id") ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY ("seat_id") REFERENCES "seat" ("id") ON DELETE RESTRICT ON UPDATE CASCADE );

CREATE TABLE "brand" ( "id" uuid_text NOT NULL PRIMARY KEY, "slug" varchar(120) NOT NULL UNIQUE, "name" varchar(255) NOT NULL, "logo_url" varchar(500) NULL, "description" text NULL, "contact_phone" varchar(20) NULL, "contact_email" varchar(255) NULL, "rating" double NULL, "status" varchar(30) NOT NULL DEFAULT 'active', "accent_color" varchar(9) NULL, "total_trips" integer NOT NULL DEFAULT 0, "created_at" text NOT NULL, "updated_at" text NOT NULL );

CREATE TABLE "bus_layout" ( "id" uuid_text NOT NULL PRIMARY KEY, "brand_id" uuid_text NULL, "name" varchar(255) NULL, "vehicle_type" varchar(30) NULL, "total_seats" smallint NULL, "layout_data" text NULL, "created_at" text NOT NULL, "updated_at" text NOT NULL, FOREIGN KEY ("brand_id") REFERENCES "brand" ("id") ON DELETE SET NULL ON UPDATE CASCADE );

CREATE TABLE "campaign" ( "id" uuid_text NOT NULL PRIMARY KEY, "brand_id" uuid_text NOT NULL, "code" varchar(50) NOT NULL UNIQUE, "discount_type" varchar(10) NOT NULL, "discount_value" bigint NOT NULL, "max_uses" bigint NULL, "used_count" bigint NOT NULL DEFAULT 0, "starts_at" text NULL, "ends_at" text NULL, "status" varchar(30) NOT NULL DEFAULT 'active', "created_at" text NOT NULL, "updated_at" text NOT NULL, FOREIGN KEY ("brand_id") REFERENCES "brand" ("id") ON DELETE SET NULL ON UPDATE CASCADE );

CREATE TABLE "chat_assignment" ( "id" uuid_text NOT NULL PRIMARY KEY, "channel_id" uuid_text NOT NULL, "employee_id" text NULL, "assigned_at" text NOT NULL, "unassigned_at" text NULL, FOREIGN KEY ("channel_id") REFERENCES "chat_channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE );

CREATE TABLE "chat_channel" ( "id" uuid_text NOT NULL PRIMARY KEY, "user_id" uuid_text NOT NULL, "brand_id" uuid_text NULL, "topic" varchar(255) NULL, "status" varchar(30) NOT NULL DEFAULT 'open', "priority" varchar(10) NOT NULL DEFAULT 'normal', "last_message_at" text NULL, "last_message_preview" varchar(500) NULL, "unread_user" integer NOT NULL DEFAULT 0, "unread_employee" integer NOT NULL DEFAULT 0, "created_at" text NOT NULL, "closed_at" text NULL, FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY ("brand_id") REFERENCES "brand" ("id") ON DELETE SET NULL ON UPDATE CASCADE );

CREATE TABLE "chat_channel_member" ( "id" uuid_text NOT NULL PRIMARY KEY, "channel_id" uuid_text NOT NULL, "user_id" uuid_text NOT NULL, "role" varchar(20) NOT NULL, "joined_at" text NOT NULL, "left_at" text NULL, FOREIGN KEY ("channel_id") REFERENCES "chat_channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE );

CREATE TABLE "chat_message" ( "id" uuid_text NOT NULL PRIMARY KEY, "channel_id" uuid_text NOT NULL, "sender_type" varchar(20) NOT NULL, "sender_id" uuid_text NULL, "content" text NULL, "kind" varchar(20) NOT NULL DEFAULT 'text', "attachments" text NULL, "status" varchar(20) NOT NULL DEFAULT 'sent', "client_msg_id" varchar(100) NULL, "created_at" text NOT NULL, FOREIGN KEY ("channel_id") REFERENCES "chat_channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE );

CREATE TABLE "discount_program" ( "id" uuid_text NOT NULL PRIMARY KEY, "brand_id" uuid_text NULL, "name" varchar(255) NOT NULL, "description" text NULL, "discount_type" varchar(10) NOT NULL, "discount_value" integer NOT NULL, "starts_at" text NULL, "ends_at" text NULL, "status" varchar(30) NOT NULL DEFAULT 'active', "created_at" text NOT NULL, FOREIGN KEY ("brand_id") REFERENCES "brand" ("id") ON DELETE SET NULL ON UPDATE CASCADE );

CREATE TABLE "job_run" ( "id" uuid_text NOT NULL PRIMARY KEY, "job_type" varchar(100) NOT NULL, "status" varchar(20) NOT NULL, "detail" text NULL, "error" text NULL, "started_at" text NULL, "finished_at" text NULL, "created_at" text NOT NULL );

CREATE TABLE "notification" ( "id" uuid_text NOT NULL PRIMARY KEY, "user_id" uuid_text NOT NULL, "type" varchar(50) NOT NULL, "title" varchar(255) NULL, "body" text NULL, "data" text NULL, "read" boolean NOT NULL DEFAULT FALSE, "created_at" text NOT NULL, FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE );

CREATE TABLE "null_claw_exchange" ( "id" uuid_text NOT NULL PRIMARY KEY, "channel_id" uuid_text NULL, "user_message_id" uuid_text NULL, "assistant_message_id" uuid_text NULL, "prompt" text NULL, "completion" text NULL, "model" varchar(50) NULL, "latency_ms" bigint NULL, "handoff_to_human" boolean NOT NULL DEFAULT FALSE, "created_at" text NOT NULL, FOREIGN KEY ("channel_id") REFERENCES "chat_channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY ("user_message_id") REFERENCES "chat_message" ("id") ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY ("assistant_message_id") REFERENCES "chat_message" ("id") ON DELETE CASCADE ON UPDATE CASCADE );

CREATE TABLE "payment" ( "id" uuid_text NOT NULL PRIMARY KEY, "booking_id" uuid_text NOT NULL, "user_id" uuid_text NULL, "provider" varchar(16) NOT NULL, "status" varchar(16) NOT NULL DEFAULT 'pending', "amount" bigint NOT NULL DEFAULT 0, "currency" varchar(3) NOT NULL DEFAULT 'VND', "created_at" text NOT NULL, "updated_at" text NOT NULL, "provider_txn_ref" varchar(64) NOT NULL UNIQUE, "provider_trans_id" varchar(64) NULL, "gateway_url" text NULL, "qr_payload" text NULL, "memo" text NULL, "provider_response" text NULL, "failure_reason" text NULL, "created_by" uuid_text NULL, "collected_at" text NULL, "collected_by" uuid_text NULL, FOREIGN KEY ("booking_id") REFERENCES "booking" ("id") ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE );

CREATE TABLE "permissions" ( "id" uuid_text NOT NULL PRIMARY KEY, "name" varchar(128) NOT NULL UNIQUE, "description" varchar NULL, "created_at" timestamp_text NOT NULL DEFAULT CURRENT_TIMESTAMP );

CREATE TABLE "pickup_point" ( "id" uuid_text NOT NULL PRIMARY KEY, "route_id" uuid_text NOT NULL, "name" varchar(255) NULL, "address" text NULL, "lat" double NULL, "lon" double NULL, "stop_order" integer NOT NULL DEFAULT 0, "kind" varchar(20) NULL, "created_at" text NOT NULL, FOREIGN KEY ("route_id") REFERENCES "route" ("id") ON DELETE CASCADE ON UPDATE CASCADE );

CREATE TABLE "place" ( "id" uuid_text NOT NULL PRIMARY KEY, "osm_id" bigint NOT NULL UNIQUE, "name" varchar(255) NOT NULL, "name_ascii" varchar(255) NULL, "name_no_tones" varchar(255) NULL, "type" varchar(30) NOT NULL, "province" varchar(255) NULL, "district" varchar(255) NULL, "ward" varchar(255) NULL, "lat" double NOT NULL, "lon" double NOT NULL, "population" integer NOT NULL DEFAULT 0, "created_at" text NOT NULL );

CREATE TABLE "posts" ( "id" uuid_text NOT NULL PRIMARY KEY, "author_id" uuid_text NOT NULL, "title" varchar(256) NOT NULL, "body" text NOT NULL, "created_at" timestamp_text NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" timestamp_text NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("author_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE );

CREATE TABLE "price_alert" ( "id" uuid_text NOT NULL PRIMARY KEY, "phone" varchar(20) NOT NULL, "email" varchar(255) NULL, "from_name" varchar(255) NULL, "to_name" varchar(255) NULL, "route_id" uuid_text NULL, "target_price" integer NULL, "frequency" varchar(10) NOT NULL DEFAULT 'daily', "status" varchar(30) NOT NULL DEFAULT 'active', "created_at" text NOT NULL, "expires_at" text NULL, "user_id" text NULL, "last_triggered_at" text NULL, FOREIGN KEY ("route_id") REFERENCES "route" ("id") ON DELETE SET NULL ON UPDATE CASCADE );

CREATE TABLE "refresh_tokens" ( "id" uuid_text NOT NULL PRIMARY KEY, "user_id" uuid_text NOT NULL, "token_hash" varchar(128) NOT NULL, "issued_at" timestamp_text NOT NULL DEFAULT CURRENT_TIMESTAMP, "expires_at" timestamp_text NOT NULL, "revoked" boolean NOT NULL DEFAULT FALSE, "user_agent" varchar NULL, "ip" varchar NULL, FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE );

CREATE TABLE "review" ( "id" uuid_text NOT NULL PRIMARY KEY, "booking_id" uuid_text NULL, "trip_session_id" uuid_text NULL, "route_id" uuid_text NULL, "brand_id" uuid_text NULL, "author_name" varchar(255) NULL, "author_phone" varchar(20) NULL, "rating" integer NOT NULL, "title" varchar(255) NULL, "content" text NULL, "tags" text NULL, "photos" text NULL, "status" varchar(30) NOT NULL DEFAULT 'published', "helpful_count" integer NOT NULL DEFAULT 0, "reply" text NULL, "replied_at" text NULL, "created_at" text NOT NULL, "updated_at" text NOT NULL, "user_id" uuid_text NULL, FOREIGN KEY ("booking_id") REFERENCES "booking" ("id") ON DELETE SET NULL ON UPDATE CASCADE, FOREIGN KEY ("trip_session_id") REFERENCES "trip_session" ("id") ON DELETE SET NULL ON UPDATE CASCADE, FOREIGN KEY ("route_id") REFERENCES "route" ("id") ON DELETE SET NULL ON UPDATE CASCADE, FOREIGN KEY ("brand_id") REFERENCES "brand" ("id") ON DELETE SET NULL ON UPDATE CASCADE, FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE );

CREATE TABLE "role_permissions" ( "role_id" uuid_text NOT NULL, "permission_id" uuid_text NOT NULL, "assigned_at" timestamp_text NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY ("role_id", "permission_id"), FOREIGN KEY ("role_id") REFERENCES "roles" ("id") ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY ("permission_id") REFERENCES "permissions" ("id") ON DELETE CASCADE ON UPDATE CASCADE );

CREATE TABLE "roles" ( "id" uuid_text NOT NULL PRIMARY KEY, "name" varchar(64) NOT NULL UNIQUE, "description" varchar NULL, "created_at" timestamp_text NOT NULL DEFAULT CURRENT_TIMESTAMP );

CREATE TABLE "route" ( "id" uuid_text NOT NULL PRIMARY KEY, "brand_id" uuid_text NULL, "name" varchar(255) NOT NULL, "start_location_id" varchar(20) NOT NULL, "end_location_id" varchar(20) NOT NULL, "status" varchar(30) NOT NULL DEFAULT 'active', "created_at" text NOT NULL, "updated_at" text NOT NULL, FOREIGN KEY ("brand_id") REFERENCES "brand" ("id") ON DELETE SET NULL ON UPDATE CASCADE );

CREATE TABLE "schedule" ( "id" uuid_text NOT NULL PRIMARY KEY, "route_id" uuid_text NOT NULL, "departure_time" text NOT NULL, "effective_from" text NULL, "effective_to" text NULL, "days_of_week" text NULL, "bus_layout_id" uuid_text NULL, "base_price_adult" bigint NOT NULL DEFAULT 0, "base_price_child" bigint NULL, "amenities" text NULL, "created_at" text NOT NULL, "vehicle_type_id" uuid_text NULL, FOREIGN KEY ("route_id") REFERENCES "route" ("id") ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY ("bus_layout_id") REFERENCES "bus_layout" ("id") ON DELETE RESTRICT ON UPDATE CASCADE, FOREIGN KEY ("vehicle_type_id") REFERENCES "vehicle_type" ("id") ON DELETE SET NULL ON UPDATE CASCADE );

CREATE TABLE "schedule_point" ( "id" uuid_text NOT NULL PRIMARY KEY, "schedule_id" uuid_text NOT NULL, "address_id" uuid_text NOT NULL, "stop_order" integer NOT NULL DEFAULT 0, "kind" varchar(20) NOT NULL, "created_at" text NOT NULL, "arrival_time" text NULL, FOREIGN KEY ("schedule_id") REFERENCES "schedule" ("id") ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY ("address_id") REFERENCES "address" ("id") ON DELETE RESTRICT ON UPDATE CASCADE );

CREATE TABLE "scheduled_job" ( "id" uuid_text NOT NULL PRIMARY KEY, "job_type" varchar(100) NOT NULL, "enabled" boolean NOT NULL, "interval_days" smallint NOT NULL, "at_hour" smallint NOT NULL, "at_minute" smallint NOT NULL, "next_run_at" text NULL, "created_at" text NOT NULL, "updated_at" text NOT NULL );

CREATE TABLE IF NOT EXISTS "seaql_migrations" ( "version" varchar NOT NULL PRIMARY KEY, "applied_at" bigint NOT NULL );

CREATE TABLE "seat" ( "id" uuid_text NOT NULL PRIMARY KEY, "bus_layout_id" uuid_text NOT NULL, "seat_label" varchar(10) NOT NULL, "seat_class" varchar(30) NULL, "row_num" smallint NULL, "col_num" smallint NULL, "is_window" boolean NOT NULL DEFAULT FALSE, "floor" smallint NOT NULL DEFAULT 1, "created_at" text NOT NULL, FOREIGN KEY ("bus_layout_id") REFERENCES "bus_layout" ("id") ON DELETE CASCADE ON UPDATE CASCADE );

CREATE TABLE "seat_inventory" ( "id" uuid_text NOT NULL PRIMARY KEY, "trip_session_id" uuid_text NOT NULL, "seat_id" uuid_text NOT NULL, "status" varchar(20) NOT NULL DEFAULT 'available', "base_price" integer NOT NULL DEFAULT 0, "final_price" integer NOT NULL DEFAULT 0, "currency" varchar(3) NOT NULL DEFAULT 'VND', "held_until" text NULL, "held_by_booking_id" uuid_text NULL, "created_at" text NOT NULL, "updated_at" text NOT NULL, FOREIGN KEY ("trip_session_id") REFERENCES "trip_session" ("id") ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY ("seat_id") REFERENCES "seat" ("id") ON DELETE RESTRICT ON UPDATE CASCADE, FOREIGN KEY ("held_by_booking_id") REFERENCES "booking" ("id") ON DELETE SET NULL ON UPDATE CASCADE );

CREATE TABLE "trip_session" ( "id" uuid_text NOT NULL PRIMARY KEY, "schedule_id" uuid_text NOT NULL, "departure_date" text NOT NULL, "actual_departure_at" text NULL, "driver_name" varchar(255) NULL, "driver_phone" varchar(20) NULL, "status" varchar(30) NOT NULL DEFAULT 'scheduled', "total_seats" bigint NOT NULL DEFAULT 0, "available_seats" bigint NOT NULL DEFAULT 0, "created_at" text NOT NULL, "updated_at" text NOT NULL, FOREIGN KEY ("schedule_id") REFERENCES "schedule" ("id") ON DELETE CASCADE ON UPDATE CASCADE );

CREATE TABLE "user" ( "id" uuid_text NOT NULL PRIMARY KEY, "brand_id" uuid_text NULL, "full_name" varchar(255) NOT NULL, "email" varchar(255) NOT NULL UNIQUE, "phone" text NULL, "email_verified_at" text NULL, "phone_verified_at" text NULL, "status" varchar(30) NOT NULL DEFAULT 'active', "block_reason" text NULL, "password_hash" varchar(255) NULL, "avatar_url" varchar(500) NULL, "locale" varchar(10) NOT NULL DEFAULT 'vi', "is_guest" boolean NOT NULL DEFAULT FALSE, "role" varchar(30) NOT NULL DEFAULT 'user', "failed_login_attempts" integer NOT NULL DEFAULT 0, "locked_until" text NULL, "last_login_at" text NULL, "last_login_ip" varchar(45) NULL, "password_changed_at" text NULL, "created_at" timestamp_text NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" timestamp_text NOT NULL DEFAULT CURRENT_TIMESTAMP, "oauth_provider" varchar(20) NULL, "oauth_subject" text NULL, "is_bot" boolean NOT NULL DEFAULT FALSE );

CREATE TABLE "user_roles" ( "user_id" uuid_text NOT NULL, "role_id" uuid_text NOT NULL, "assigned_at" timestamp_text NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY ("user_id", "role_id"), FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY ("role_id") REFERENCES "roles" ("id") ON DELETE CASCADE ON UPDATE CASCADE );

CREATE TABLE "user_verification" ( "id" uuid_text NOT NULL PRIMARY KEY, "user_id" uuid_text NOT NULL, "channel" varchar(10) NOT NULL, "target" varchar(255) NOT NULL, "code_hash" varchar(255) NOT NULL, "purpose" varchar(30) NOT NULL, "attempts" integer NOT NULL DEFAULT 0, "expires_at" text NOT NULL, "consumed_at" text NULL, FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE );

CREATE TABLE "vehicle_type" ( "id" uuid_text NOT NULL PRIMARY KEY, "code" varchar(60) NOT NULL UNIQUE, "label" varchar(120) NOT NULL, "description" text NULL, "total_seats" smallint NULL, "sort_order" smallint NOT NULL DEFAULT 0, "status" varchar(20) NOT NULL DEFAULT 'active', "created_at" text NOT NULL, "updated_at" text NOT NULL );

CREATE TABLE "wishlist_item" ( "id" uuid_text NOT NULL PRIMARY KEY, "user_id" uuid_text NOT NULL, "route_id" uuid_text NOT NULL, "created_at" text NOT NULL, FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY ("route_id") REFERENCES "route" ("id") ON DELETE CASCADE ON UPDATE CASCADE );

CREATE INDEX "Address_brand_idx" ON "address" ("brand_id");

CREATE INDEX "AuditLog_actor_idx" ON "audit_log" ("actor_type", "actor_id");

CREATE INDEX "AuditLog_createdAt_idx" ON "audit_log" ("created_at");

CREATE INDEX "AuditLog_target_idx" ON "audit_log" ("target_type", "target_id");

CREATE INDEX "BookingSeat_bookingId_idx" ON "booking_seat" ("booking_id");

CREATE UNIQUE INDEX "BookingSeat_booking_seat_uniq" ON "booking_seat" ("booking_id", "seat_id");

CREATE INDEX "Booking_contactPhone_idx" ON "booking" ("contact_phone");

CREATE INDEX "Booking_status_createdAt_id_idx" ON "booking" ("status", "created_at" DESC, "id" DESC);

CREATE INDEX "Booking_status_createdAt_idx" ON "booking" ("status", "created_at");

CREATE INDEX "Booking_status_idx" ON "booking" ("status");

CREATE INDEX "Booking_tripSessionId_idx" ON "booking" ("trip_session_id");

CREATE INDEX "Booking_userId_createdAt_idx" ON "booking" ("user_id", "created_at");

CREATE INDEX "Booking_userId_idx" ON "booking" ("user_id");

CREATE INDEX "Booking_user_status_idx" ON "booking" ("user_id", "status");

CREATE INDEX "BusLayout_brandId_idx" ON "bus_layout" ("brand_id");

CREATE INDEX "Campaign_brandId_idx" ON "campaign" ("brand_id");

CREATE INDEX "Campaign_date_range_status_idx" ON "campaign" ("starts_at", "ends_at", "status");

CREATE INDEX "Campaign_status_idx" ON "campaign" ("status");

CREATE INDEX "ChatAssignment_channelId_idx" ON "chat_assignment" ("channel_id");

CREATE UNIQUE INDEX "ChatAssignment_channel_active_uniq" ON "chat_assignment" ("channel_id");

CREATE INDEX "ChatAssignment_employeeId_idx" ON "chat_assignment" ("employee_id");

CREATE INDEX "ChatChannelMember_channelId_idx" ON "chat_channel_member" ("channel_id");

CREATE UNIQUE INDEX "ChatChannelMember_channel_user_uniq" ON "chat_channel_member" ("channel_id", "user_id");

CREATE INDEX "ChatChannelMember_userId_idx" ON "chat_channel_member" ("user_id");

CREATE INDEX "ChatChannel_brandId_idx" ON "chat_channel" ("brand_id");

CREATE INDEX "ChatChannel_status_lastMessage_idx" ON "chat_channel" ("status", "last_message_at");

CREATE INDEX "ChatChannel_status_priority_lastMessageAt_idx" ON "chat_channel" ("status", "priority", "last_message_at");

CREATE INDEX "ChatChannel_userId_idx" ON "chat_channel" ("user_id");

CREATE INDEX "ChatMessage_channelId_createdAt_idx" ON "chat_message" ("channel_id", "created_at");

CREATE INDEX "ChatMessage_channelId_idx" ON "chat_message" ("channel_id");

CREATE UNIQUE INDEX "ChatMessage_clientMsgId_uniq" ON "chat_message" ("channel_id", "client_msg_id");

CREATE INDEX "ChatMessage_senderType_idx" ON "chat_message" ("sender_type");

CREATE INDEX "DiscountProgram_brandId_idx" ON "discount_program" ("brand_id");

CREATE INDEX "DiscountProgram_status_idx" ON "discount_program" ("status");

CREATE INDEX "JobRun_job_type_created_idx" ON "job_run" ("job_type", "created_at");

CREATE INDEX "JobRun_status_idx" ON "job_run" ("status");

CREATE INDEX "Notification_userId_idx" ON "notification" ("user_id");

CREATE INDEX "Notification_user_read_idx" ON "notification" ("user_id", "read");

CREATE INDEX "NullClawExchange_channel_idx" ON "null_claw_exchange" ("channel_id");

CREATE INDEX "Payment_bookingId_idx" ON "payment" ("booking_id");

CREATE INDEX "Payment_bookingId_status_idx" ON "payment" ("booking_id", "status");

CREATE INDEX "Payment_createdAt_idx" ON "payment" ("created_at");

CREATE INDEX "Payment_provider_status_idx" ON "payment" ("provider", "status");

CREATE INDEX "Payment_status_idx" ON "payment" ("status");

CREATE INDEX "PickupPoint_routeId_idx" ON "pickup_point" ("route_id");

CREATE INDEX "PickupPoint_route_order_idx" ON "pickup_point" ("route_id", "stop_order");

CREATE INDEX "Place_nameAscii_idx" ON "place" ("name_ascii");

CREATE INDEX "Place_nameNoTones_idx" ON "place" ("name_no_tones");

CREATE INDEX "Place_name_idx" ON "place" ("name");

CREATE INDEX "Place_province_idx" ON "place" ("province");

CREATE INDEX "Place_type_idx" ON "place" ("type");

CREATE INDEX "Posts_createdAt_idx" ON "posts" ("created_at" DESC);

CREATE INDEX "PriceAlert_phone_idx" ON "price_alert" ("phone");

CREATE INDEX "PriceAlert_routeId_idx" ON "price_alert" ("route_id");

CREATE INDEX "PriceAlert_status_idx" ON "price_alert" ("status");

CREATE INDEX "PriceAlert_userId_idx" ON "price_alert" ("user_id");

CREATE INDEX "Review_brandId_createdAt_idx" ON "review" ("brand_id", "created_at");

CREATE INDEX "Review_brandId_idx" ON "review" ("brand_id");

CREATE INDEX "Review_routeId_createdAt_idx" ON "review" ("route_id", "created_at");

CREATE INDEX "Review_routeId_idx" ON "review" ("route_id");

CREATE INDEX "Review_status_createdAt_idx" ON "review" ("status", "created_at");

CREATE INDEX "Review_status_idx" ON "review" ("status");

CREATE INDEX "Review_userId_idx" ON "review" ("user_id");

CREATE INDEX "Route_brandId_idx" ON "route" ("brand_id");

CREATE INDEX "Route_startEnd_idx" ON "route" ("start_location_id", "end_location_id");

CREATE INDEX "Route_status_idx" ON "route" ("status");

CREATE INDEX "SchedulePoint_address_idx" ON "schedule_point" ("address_id");

CREATE INDEX "SchedulePoint_schedule_idx" ON "schedule_point" ("schedule_id");

CREATE INDEX "Schedule_effective_range_idx" ON "schedule" ("effective_from", "effective_to");

CREATE INDEX "Schedule_routeId_idx" ON "schedule" ("route_id");

CREATE INDEX "Schedule_route_departure_idx" ON "schedule" ("route_id", "departure_time");

CREATE INDEX "Schedule_vehicle_type_idx" ON "schedule" ("vehicle_type_id");

CREATE UNIQUE INDEX "ScheduledJob_job_type_uq" ON "scheduled_job" ("job_type");

CREATE INDEX "SeatInventory_heldByBookingId_idx" ON "seat_inventory" ("held_by_booking_id");

CREATE INDEX "SeatInventory_seatId_idx" ON "seat_inventory" ("seat_id");

CREATE INDEX "SeatInventory_tripSessionId_idx" ON "seat_inventory" ("trip_session_id");

CREATE INDEX "SeatInventory_tripSessionId_status_idx" ON "seat_inventory" ("trip_session_id", "status");

CREATE UNIQUE INDEX "SeatInventory_trip_seat_uniq" ON "seat_inventory" ("trip_session_id", "seat_id");

CREATE INDEX "Seat_busLayoutId_idx" ON "seat" ("bus_layout_id");

CREATE UNIQUE INDEX "Seat_layout_label_uniq" ON "seat" ("bus_layout_id", "seat_label");

CREATE INDEX "TripSession_date_status_idx" ON "trip_session" ("departure_date", "status");

CREATE INDEX "TripSession_departureDate_idx" ON "trip_session" ("departure_date");

CREATE INDEX "TripSession_scheduleId_idx" ON "trip_session" ("schedule_id");

CREATE UNIQUE INDEX "TripSession_schedule_date_uniq" ON "trip_session" ("schedule_id", "departure_date");

CREATE INDEX "UserVerification_target_purpose_idx" ON "user_verification" ("target", "purpose");

CREATE INDEX "UserVerification_userId_idx" ON "user_verification" ("user_id");

CREATE INDEX "User_brandId_idx" ON "user" ("brand_id");

CREATE INDEX "User_createdAt_idx" ON "user" ("created_at" DESC);

CREATE UNIQUE INDEX "User_oauth_provider_subject_uniq" ON "user" ("oauth_provider", "oauth_subject");

CREATE INDEX "User_status_idx" ON "user" ("status");

CREATE INDEX "WishlistItem_userId_idx" ON "wishlist_item" ("user_id");

CREATE UNIQUE INDEX "WishlistItem_user_route_uniq" ON "wishlist_item" ("user_id", "route_id");

CREATE INDEX "idx_posts_author" ON "posts" ("author_id");

CREATE INDEX "idx_refresh_tokens_hash" ON "refresh_tokens" ("token_hash");

CREATE INDEX "idx_refresh_tokens_user" ON "refresh_tokens" ("user_id");

CREATE UNIQUE INDEX "role_permissions_role_perm_uniq" ON "role_permissions" ("role_id", "permission_id");

