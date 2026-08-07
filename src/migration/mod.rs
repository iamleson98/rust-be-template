//! SeaORM migrations.
//!
//! Apply via `backend migrate up` (see `src/cli/commands/migrate.rs`).

pub use sea_orm_migration::prelude::*;

mod m20250101_000001_create_users;
mod m20250101_000002_create_posts;
mod m20250101_000003_create_rbac;
mod m20250101_000004_create_refresh_tokens;
mod m20250101_000005_seed_rbac;

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
        ]
    }
}
