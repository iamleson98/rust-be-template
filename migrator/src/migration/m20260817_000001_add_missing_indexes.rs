use sea_orm_migration::prelude::*;

/// Add missing indexes identified by the performance audit:
///
/// - `Booking_contactPhone_idx` — used by `lookup_bookings` (the guest
///   booking lookup endpoint `POST /bookings/lookup`). Without this index
///   the lookup is a full table scan on every guest request. The original
///   migration `m20260809_020741_bookings.rs` documented `contact_phone`
///   as "indexed" in a code comment but never actually created the index.
///
/// - `SeatInventory_heldByBookingId_idx` — used by
///   `list_seat_inventories_by_held_booking` and
///   `release_held_seats_for_booking`. Without this index, both the
///   cancel and confirm flows (plus the expiry-cleanup branch) full-scan
///   the `seat_inventory` table — which can be 40 seats × thousands of
///   trips = tens of thousands of rows. The booking cancellation hot path
///   would dominate latency under load.
///
/// Both indexes are additive and idempotent (`if_not_exists`).
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // 1. Index on `booking.contact_phone` — guest lookup by phone.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("Booking_contactPhone_idx")
                    .table(Booking::Table)
                    .col(Booking::ContactPhone)
                    .to_owned(),
            )
            .await?;

        // 2. Index on `seat_inventory.held_by_booking_id` — cancel/confirm
        //    flows release held seats by this column.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("SeatInventory_heldByBookingId_idx")
                    .table(SeatInventory::Table)
                    .col(SeatInventory::HeldByBookingId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .if_exists()
                    .name("SeatInventory_heldByBookingId_idx")
                    .table(SeatInventory::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .if_exists()
                    .name("Booking_contactPhone_idx")
                    .table(Booking::Table)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Booking {
    Table,
    ContactPhone,
}

#[derive(DeriveIden)]
enum SeatInventory {
    Table,
    HeldByBookingId,
}
