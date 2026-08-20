use sea_orm_migration::{prelude::*, schema::*};

use crate::migration::{
    m20250101_000001_create_users::User,
    m20260809_014716_routes_pickups_buslayout_seats::{PickupPoint, Seat},
    m20260809_020540_schedules_trips_campaigns::{Campaign, TripSession},
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden)]
pub enum Booking {
    Table,
    Id,
    Code,
    UserId,
    GuestName,
    GuestPhone,
    GuestEmail,
    TripSessionId,
    BoardingPointId,
    DroppingPointId,
    AdultCount,
    ChildCount,
    Subtotal,
    Discount,
    Fees,
    Total,
    Currency,
    Status,
    PaymentMethod,
    CampaignAppliedId,
    ExpiresAt,
    ContactName,
    ContactPhone,
    ContactEmail,
    CreatedAt,
    UpdatedAt,
    DropoffAddress,
    DropoffLat,
    DropoffLon,
    DropoffName,
    PickupAddress,
    PickupLat,
    PickupLon,
    PickupName,
}

#[derive(DeriveIden)]
pub enum BookingSeat {
    Table,
    Id,
    BookingId,
    SeatId,
    PassengerName,
    PassengerAge,
    PassengerType,
    Price,
    CreatedAt,
}

#[derive(DeriveIden)]
pub enum SeatInventory {
    Table,
    Id,
    TripSessionId,
    SeatId,
    Status,
    BasePrice,
    FinalPrice,
    Currency,
    HeldUntil,
    HeldByBookingId,
    CreatedAt,
    UpdatedAt,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Booking
        manager
            .create_table(
                Table::create()
                    .table(Booking::Table)
                    .if_not_exists()
                    .col(pk_uuid(Booking::Id))
                    .col(string_len_uniq(Booking::Code, 20))
                    .col(uuid_null(Booking::UserId))
                    .col(string_len_null(Booking::GuestName, 255))
                    .col(string_len_null(Booking::GuestPhone, 20))
                    .col(string_len_null(Booking::GuestEmail, 255))
                    .col(text(Booking::TripSessionId))
                    .col(uuid_null(Booking::BoardingPointId))
                    .col(uuid_null(Booking::DroppingPointId))
                    .col(integer(Booking::AdultCount).default(1))
                    .col(integer(Booking::ChildCount).default(0))
                    .col(integer(Booking::Subtotal).default(0))
                    .col(integer(Booking::Discount).default(0))
                    .col(integer(Booking::Fees).default(0))
                    .col(integer(Booking::Total).default(0))
                    .col(string_len(Booking::Currency, 3).default("VND"))
                    .col(string_len(Booking::Status, 30).default("pending"))
                    .col(string_len_null(Booking::PaymentMethod, 30))
                    .col(uuid_null(Booking::CampaignAppliedId))
                    .col(text_null(Booking::ExpiresAt))
                    .col(string_len_null(Booking::ContactName, 255))
                    .col(string_len_null(Booking::ContactPhone, 20))
                    .col(string_len_null(Booking::ContactEmail, 255))
                    .col(text(Booking::CreatedAt))
                    .col(text(Booking::UpdatedAt))
                    .col(text_null(Booking::DropoffAddress))
                    .col(double_null(Booking::DropoffLat))
                    .col(double_null(Booking::DropoffLon))
                    .col(string_len_null(Booking::DropoffName, 255))
                    .col(text_null(Booking::PickupAddress))
                    .col(double_null(Booking::PickupLat))
                    .col(double_null(Booking::PickupLon))
                    .col(string_len_null(Booking::PickupName, 255))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_booking_user")
                            .from(Booking::Table, Booking::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_booking_trip")
                            .from(Booking::Table, Booking::TripSessionId)
                            .to(TripSession::Table, TripSession::Id)
                            .on_delete(ForeignKeyAction::Restrict)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_booking_boarding")
                            .from(Booking::Table, Booking::BoardingPointId)
                            .to(PickupPoint::Table, PickupPoint::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_booking_dropping")
                            .from(Booking::Table, Booking::DroppingPointId)
                            .to(PickupPoint::Table, PickupPoint::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_booking_campaign")
                            .from(Booking::Table, Booking::CampaignAppliedId)
                            .to(Campaign::Table, Campaign::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("Booking_userId_idx")
                    .table(Booking::Table)
                    .col(Booking::UserId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("Booking_tripSessionId_idx")
                    .table(Booking::Table)
                    .col(Booking::TripSessionId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("Booking_status_idx")
                    .table(Booking::Table)
                    .col(Booking::Status)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("Booking_user_status_idx")
                    .table(Booking::Table)
                    .col(Booking::UserId)
                    .col(Booking::Status)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("Booking_userId_createdAt_idx")
                    .table(Booking::Table)
                    .col(Booking::UserId)
                    .col(Booking::CreatedAt)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("Booking_status_createdAt_idx")
                    .table(Booking::Table)
                    .col(Booking::Status)
                    .col(Booking::CreatedAt)
                    .to_owned(),
            )
            .await?;

        // BookingSeat
        manager
            .create_table(
                Table::create()
                    .table(BookingSeat::Table)
                    .if_not_exists()
                    .col(pk_uuid(BookingSeat::Id))
                    .col(uuid(BookingSeat::BookingId))
                    .col(uuid(BookingSeat::SeatId))
                    .col(string_len_null(BookingSeat::PassengerName, 255))
                    .col(small_integer_null(BookingSeat::PassengerAge))
                    .col(string_len_null(BookingSeat::PassengerType, 10))
                    .col(integer(BookingSeat::Price).default(0))
                    .col(text(BookingSeat::CreatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_bookingseat_booking")
                            .from(BookingSeat::Table, BookingSeat::BookingId)
                            .to(Booking::Table, Booking::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_bookingseat_seat")
                            .from(BookingSeat::Table, BookingSeat::SeatId)
                            .to(Seat::Table, Seat::Id)
                            .on_delete(ForeignKeyAction::Restrict)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("BookingSeat_bookingId_idx")
                    .table(BookingSeat::Table)
                    .col(BookingSeat::BookingId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("BookingSeat_booking_seat_uniq")
                    .table(BookingSeat::Table)
                    .col(BookingSeat::BookingId)
                    .col(BookingSeat::SeatId)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // SeatInventory
        manager
            .create_table(
                Table::create()
                    .table(SeatInventory::Table)
                    .if_not_exists()
                    .col(pk_uuid(SeatInventory::Id))
                    .col(uuid(SeatInventory::TripSessionId))
                    .col(uuid(SeatInventory::SeatId))
                    .col(string_len(SeatInventory::Status, 20).default("available"))
                    .col(integer(SeatInventory::BasePrice).default(0))
                    .col(integer(SeatInventory::FinalPrice).default(0))
                    .col(string_len(SeatInventory::Currency, 3).default("VND"))
                    .col(text_null(SeatInventory::HeldUntil))
                    .col(uuid_null(SeatInventory::HeldByBookingId))
                    .col(text(SeatInventory::CreatedAt))
                    .col(text(SeatInventory::UpdatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_seatinventory_trip")
                            .from(SeatInventory::Table, SeatInventory::TripSessionId)
                            .to(TripSession::Table, TripSession::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_seatinventory_seat")
                            .from(SeatInventory::Table, SeatInventory::SeatId)
                            .to(Seat::Table, Seat::Id)
                            .on_delete(ForeignKeyAction::Restrict)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_seatinventory_booking")
                            .from(SeatInventory::Table, SeatInventory::HeldByBookingId)
                            .to(Booking::Table, Booking::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("SeatInventory_tripSessionId_idx")
                    .table(SeatInventory::Table)
                    .col(SeatInventory::TripSessionId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("SeatInventory_seatId_idx")
                    .table(SeatInventory::Table)
                    .col(SeatInventory::SeatId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("SeatInventory_tripSessionId_status_idx")
                    .table(SeatInventory::Table)
                    .col(SeatInventory::TripSessionId)
                    .col(SeatInventory::Status)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("SeatInventory_trip_seat_uniq")
                    .table(SeatInventory::Table)
                    .col(SeatInventory::TripSessionId)
                    .col(SeatInventory::SeatId)
                    .unique()
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(SeatInventory::Table)
                    .cascade()
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(BookingSeat::Table).cascade().to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Booking::Table).cascade().to_owned())
            .await?;
        Ok(())
    }
}
