//! `address.city_id`: the city (slug from the app's city list) each
//! address belongs to.
//!
//! Existing points get the city whose name their stored province spells
//! exactly (with or without "Thành phố" / "Tỉnh" / "TP."), and their
//! province is rewritten to that city's canonical spelling; the rest stay
//! NULL for staff to pick. The mapping is the one the Worker shipped
//! (its migration `0009_address_city`), so imported and migrated
//! databases agree.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Address::Table)
                    .add_column(ColumnDef::new(Address::CityId).text().null())
                    .to_owned(),
            )
            .await?;
        manager
            .get_connection()
            .execute_unprepared(include_str!("sql/address_city_id_backfill.sql"))
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Address::Table)
                    .drop_column(Address::CityId)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum Address {
    Table,
    CityId,
}
