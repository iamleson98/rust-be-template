//! SeaORM migrations.
//!
//! Apply via `migrator up` (see `migrator/src/main.rs`) or `make
//! migrate-up`.
//!
//! ## Layout (from scratch — clean dependency order)
//!
//! | # | Migration | Tables |
//! |---|-----------|--------|
//! | 1 | `create_users_auth`      | user, posts, refresh_tokens, user_verification, audit_log, notification |
//! | 2 | `create_rbac`            | roles, permissions, user_roles, role_permissions |
//! | 3 | `create_catalog`         | place, brand, vehicle_type, address |
//! | 4 | `create_route_network`   | route, pickup_point, bus_layout, seat |
//! | 5 | `create_schedules`       | schedule, schedule_point, trip_session |
//! | 6 | `create_promotions`      | campaign, discount_program |
//! | 7 | `create_bookings`        | booking, booking_seat, seat_inventory, payment, review |
//! | 8 | `create_chat`            | chat_channel, chat_message, chat_assignment, chat_channel_member, nullclaw_exchange |
//! | 9 | `create_engagement_jobs` | wishlist_item, price_alert, scheduled_job, job_run |
//! | 10 | `seed_defaults`         | RBAC roles/permissions/grants + vehicle-type catalogue |
//!
//! Tables are created strictly in FK dependency order (referenced tables
//! first). All seed data lives in the final migration so it runs after
//! every permission-introducing table migration. Each file is
//! self-contained — it redefines the minimal Iden enums it needs
//! (for FK targets owned by earlier migrations)
//! instead of importing another migration module's enums.
//!
//! Runtime-seeded data (NOT in migrations):
//!   * the admin account — the first registered user is promoted by
//!     `AuthService::register`
//!   * the NullClaw bot account — created on first registration
//!   * `scheduled_job` rows — seeded by `JobService::ensure_default_jobs`
//!     at server boot (first `next_run_at` relative to first boot)

pub use sea_orm_migration::prelude::*;

mod m20260905_000001_create_users_auth;
mod m20260905_000002_create_rbac;
mod m20260905_000003_create_catalog;
mod m20260905_000004_create_route_network;
mod m20260905_000005_create_schedules;
mod m20260905_000006_create_promotions;
mod m20260905_000007_create_bookings;
mod m20260905_000008_create_chat;
mod m20260905_000009_create_engagement_jobs;
mod m20260905_000010_seed_defaults;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20260905_000001_create_users_auth::Migration),
            Box::new(m20260905_000002_create_rbac::Migration),
            Box::new(m20260905_000003_create_catalog::Migration),
            Box::new(m20260905_000004_create_route_network::Migration),
            Box::new(m20260905_000005_create_schedules::Migration),
            Box::new(m20260905_000006_create_promotions::Migration),
            Box::new(m20260905_000007_create_bookings::Migration),
            Box::new(m20260905_000008_create_chat::Migration),
            Box::new(m20260905_000009_create_engagement_jobs::Migration),
            Box::new(m20260905_000010_seed_defaults::Migration),
        ]
    }
}
