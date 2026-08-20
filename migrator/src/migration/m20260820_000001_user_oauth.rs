//! Adds OAuth identity columns to the `user` table so users can sign
//! in via Facebook / Google / X (Twitter) without a password.
//!
//! Two nullable columns:
//!   * `oauth_provider` — `"facebook"` | `"google"` | `"twitter"` (NULL
//!     for password-only users).
//!   * `oauth_subject`  — the provider's stable user id (e.g. Google's
//!     `sub` claim, Facebook's numeric user id). NULL when not bound.
//!
//! Together they form a unique constraint: a given `(provider, subject)`
//! pair can only map to one local user. Email collisions are handled in
//! the OAuth service — if an existing user has the same email, we link
//! the OAuth identity to that user instead of creating a duplicate.

use sea_orm_migration::prelude::*;

use crate::migration::m20250101_000001_create_users::User;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Add `oauth_provider` (NULL for password-only users).
        manager
            .alter_table(
                Table::alter()
                    .table(User::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(Alias::new("oauth_provider"))
                            .string_len(20)
                            .null()
                            .to_owned(),
                    )
                    .to_owned(),
            )
            .await?;

        // Add `oauth_subject` (provider's stable user id).
        manager
            .alter_table(
                Table::alter()
                    .table(User::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(Alias::new("oauth_subject"))
                            .text()
                            .null()
                            .to_owned(),
                    )
                    .to_owned(),
            )
            .await?;

        // Unique index on (provider, subject) so the same OAuth identity
        // can't be linked to two local users.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("User_oauth_provider_subject_uniq")
                    .table(User::Table)
                    .col(Alias::new("oauth_provider"))
                    .col(Alias::new("oauth_subject"))
                    .unique()
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name("User_oauth_provider_subject_uniq")
                    .table(User::Table)
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(User::Table)
                    .drop_column(Alias::new("oauth_subject"))
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(User::Table)
                    .drop_column(Alias::new("oauth_provider"))
                    .to_owned(),
            )
            .await?;

        Ok(())
    }
}
