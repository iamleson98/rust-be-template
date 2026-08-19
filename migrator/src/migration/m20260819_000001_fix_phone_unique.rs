//! Fix: phone column was UNIQUE + NOT NULL with default "" — only ONE
//! user could have an empty phone. New users failed with a "duplicate
//! key" error that looked like an email conflict.
//!
//! This migration recreates the user table WITHOUT the UNIQUE constraint
//! on phone (keeps UNIQUE on email since that's the login key).
//! Phone is made nullable (NULL = no phone provided).

use sea_orm_migration::prelude::*;
use sea_orm::Statement;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        // SQLite doesn't support ALTER TABLE DROP CONSTRAINT.
        // Recreate the table without UNIQUE on phone.

        // Step 1: Create new table
        db.execute(Statement::from_string(
            sea_orm::DatabaseBackend::Sqlite,
            r#"CREATE TABLE user_new (
                id TEXT PRIMARY KEY NOT NULL,
                brand_id TEXT,
                full_name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                phone TEXT,
                email_verified_at TEXT,
                phone_verified_at TEXT,
                status VARCHAR(30) NOT NULL DEFAULT 'active',
                block_reason TEXT,
                password_hash VARCHAR(255),
                avatar_url VARCHAR(500),
                locale VARCHAR(10) NOT NULL DEFAULT 'vi',
                is_guest BOOLEAN NOT NULL DEFAULT 0,
                role VARCHAR(30) NOT NULL DEFAULT 'user',
                failed_login_attempts INTEGER NOT NULL DEFAULT 0,
                locked_until TEXT,
                last_login_at TEXT,
                last_login_ip VARCHAR(45),
                password_changed_at TEXT,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );"#,
        )).await?;

        // Step 2: Copy data, converting empty phone to NULL
        db.execute(Statement::from_string(
            sea_orm::DatabaseBackend::Sqlite,
            r#"INSERT INTO user_new (id, brand_id, full_name, email, phone,
                email_verified_at, phone_verified_at, status, block_reason,
                password_hash, avatar_url, locale, is_guest, role,
                failed_login_attempts, locked_until, last_login_at,
                last_login_ip, password_changed_at, created_at, updated_at)
            SELECT id, brand_id, full_name, email,
                CASE WHEN phone = '' THEN NULL ELSE phone END,
                email_verified_at, phone_verified_at, status, block_reason,
                password_hash, avatar_url, locale, is_guest, role,
                failed_login_attempts, locked_until, last_login_at,
                last_login_ip, password_changed_at, created_at, updated_at
            FROM user;"#,
        )).await?;

        // Step 3: Drop old + rename
        db.execute(Statement::from_string(
            sea_orm::DatabaseBackend::Sqlite,
            "DROP TABLE user;",
        )).await?;

        db.execute(Statement::from_string(
            sea_orm::DatabaseBackend::Sqlite,
            "ALTER TABLE user_new RENAME TO user;",
        )).await?;

        // Step 4: Recreate indexes
        db.execute(Statement::from_string(
            sea_orm::DatabaseBackend::Sqlite,
            "CREATE INDEX IF NOT EXISTS User_email_idx ON user (email);",
        )).await?;

        db.execute(Statement::from_string(
            sea_orm::DatabaseBackend::Sqlite,
            "CREATE INDEX IF NOT EXISTS User_status_idx ON user (status);",
        )).await?;

        db.execute(Statement::from_string(
            sea_orm::DatabaseBackend::Sqlite,
            "CREATE INDEX IF NOT EXISTS User_brandId_idx ON user (brand_id);",
        )).await?;

        tracing::info!("fixed user table: phone is now nullable + non-unique");
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
