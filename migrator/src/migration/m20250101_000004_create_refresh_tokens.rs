use sea_orm_migration::{prelude::*, schema::*};


#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(RefreshTokens::Table)
                    .if_not_exists()
                    .col(pk_uuid(RefreshTokens::Id))
                    .col(uuid(RefreshTokens::UserId))
                    .col(string_len(RefreshTokens::TokenHash, 128))
                    .col(timestamp(RefreshTokens::IssuedAt).default(Expr::current_timestamp()))
                    .col(timestamp(RefreshTokens::ExpiresAt))
                    .col(boolean(RefreshTokens::Revoked).default(false))
                    .col(string_null(RefreshTokens::UserAgent))
                    .col(string_null(RefreshTokens::Ip))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_refresh_tokens_user")
                            .from(RefreshTokens::Table, RefreshTokens::UserId)
                            .to(sea_orm::sea_query::Alias::new("user"), sea_orm::sea_query::Alias::new("id"))
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_refresh_tokens_hash")
                    .table(RefreshTokens::Table)
                    .col(RefreshTokens::TokenHash)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_refresh_tokens_user")
                    .table(RefreshTokens::Table)
                    .col(RefreshTokens::UserId)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(RefreshTokens::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum RefreshTokens {
    Table,
    Id,
    UserId,
    TokenHash,
    IssuedAt,
    ExpiresAt,
    Revoked,
    UserAgent,
    Ip,
}
