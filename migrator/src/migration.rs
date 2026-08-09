//! SeaORM migrations.
//!
//! Apply via `migrator up` (see `migrator/src/main.rs`).

pub use sea_orm_migration::prelude::*;

mod m20250101_000001_create_users;
mod m20250101_000002_create_posts;
mod m20250101_000003_create_rbac;
mod m20250101_000004_create_refresh_tokens;
mod m20250101_000005_seed_rbac;
mod m20260809_013648_places_brands;
mod m20260809_014716_routes_pickups_buslayout_seats;
mod m20260809_020540_schedules_trips_campaigns;
mod m20260809_020741_bookings;
mod m20260809_021017_auth_audit;
mod m20260809_021159_reviews;
mod m20260809_021323_chat;
mod m20260809_021431_notifications_wishlist_alerts;
mod m20260809_021550_discounts;
mod m20260809_021759_zeroclaw;
mod m20260809_030000_price_alert_owner;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20250101_000001_create_users::Migration),
            Box::new(m20250101_000002_create_posts::Migration),
            Box::new(m20250101_000003_create_rbac::Migration),
            Box::new(m20250101_000004_create_refresh_tokens::Migration),
            Box::new(m20250101_000005_seed_rbac::Migration),
            Box::new(m20260809_013648_places_brands::Migration),
            Box::new(m20260809_014716_routes_pickups_buslayout_seats::Migration),
            Box::new(m20260809_020540_schedules_trips_campaigns::Migration),
            Box::new(m20260809_020741_bookings::Migration),
            Box::new(m20260809_021017_auth_audit::Migration),
            Box::new(m20260809_021159_reviews::Migration),
            Box::new(m20260809_021323_chat::Migration),
            Box::new(m20260809_021431_notifications_wishlist_alerts::Migration),
            Box::new(m20260809_021550_discounts::Migration),
            Box::new(m20260809_021759_zeroclaw::Migration),
            Box::new(m20260809_030000_price_alert_owner::Migration),
        ]
    }
}
