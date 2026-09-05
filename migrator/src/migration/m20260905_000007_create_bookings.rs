//! Bookings & money — bookings, booked seats, per-trip seat inventory,
//! payments and reviews.
//!
//!   1. `booking`        — a ticket order (user or guest, trip, boarding
//!                         /dropping points, pricing breakdown, contact
//!                         info, optional home pickup/dropoff geo)
//!   2. `booking_seat`   — passenger-per-seat line items
//!   3. `seat_inventory` — per-trip seat availability + hold state
//!   4. `payment`        — provider payment attempts (VNPay/MoMo/ZaloPay/
//!                         VietQR/COD) with IPN state machine
//!   5. `review`         — trip/brand reviews with moderation workflow

use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // ── booking ──────────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(Booking::Table)
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

        for (idx, cols) in [
            ("Booking_userId_idx", vec![Booking::UserId]),
            ("Booking_tripSessionId_idx", vec![Booking::TripSessionId]),
            ("Booking_status_idx", vec![Booking::Status]),
            (
                "Booking_user_status_idx",
                vec![Booking::UserId, Booking::Status],
            ),
            (
                "Booking_userId_createdAt_idx",
                vec![Booking::UserId, Booking::CreatedAt],
            ),
            (
                "Booking_status_createdAt_idx",
                vec![Booking::Status, Booking::CreatedAt],
            ),
            // Guest booking lookup (`POST /bookings/lookup`) by phone.
            ("Booking_contactPhone_idx", vec![Booking::ContactPhone]),
        ] {
            let mut index = Index::create();
            index.name(idx).table(Booking::Table);
            for col in cols {
                index.col(col);
            }
            manager.create_index(index.to_owned()).await?;
        }
        // Keyset-pagination-ready composite for booking exports.
        manager
            .create_index(
                Index::create()
                    .name("Booking_status_createdAt_id_idx")
                    .table(Booking::Table)
                    .col(Booking::Status)
                    .col((Booking::CreatedAt, IndexOrder::Desc))
                    .col((Booking::Id, IndexOrder::Desc))
                    .to_owned(),
            )
            .await?;

        // ── booking_seat ─────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(BookingSeat::Table)
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
                    .name("BookingSeat_bookingId_idx")
                    .table(BookingSeat::Table)
                    .col(BookingSeat::BookingId)
                    .to_owned(),
            )
            .await?;
        // A seat is booked at most once per booking.
        manager
            .create_index(
                Index::create()
                    .name("BookingSeat_booking_seat_uniq")
                    .table(BookingSeat::Table)
                    .col(BookingSeat::BookingId)
                    .col(BookingSeat::SeatId)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // ── seat_inventory ───────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(SeatInventory::Table)
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

        for (idx, cols, uniq) in [
            (
                "SeatInventory_tripSessionId_idx",
                vec![SeatInventory::TripSessionId],
                false,
            ),
            (
                "SeatInventory_seatId_idx",
                vec![SeatInventory::SeatId],
                false,
            ),
            (
                "SeatInventory_tripSessionId_status_idx",
                vec![SeatInventory::TripSessionId, SeatInventory::Status],
                false,
            ),
            (
                "SeatInventory_trip_seat_uniq",
                vec![SeatInventory::TripSessionId, SeatInventory::SeatId],
                true,
            ),
            // Cancel/confirm flows release held seats by booking id —
            // without this both paths full-scan the inventory table.
            (
                "SeatInventory_heldByBookingId_idx",
                vec![SeatInventory::HeldByBookingId],
                false,
            ),
        ] {
            let mut index = Index::create();
            index.name(idx).table(SeatInventory::Table);
            for col in cols {
                index.col(col);
            }
            if uniq {
                index.unique();
            }
            manager.create_index(index.to_owned()).await?;
        }

        // ── payment ──────────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(Payment::Table)
                    .col(pk_uuid(Payment::Id))
                    .col(uuid(Payment::BookingId))
                    .col(uuid_null(Payment::UserId))
                    .col(string_len(Payment::Provider, 16))
                    .col(string_len(Payment::Status, 16).default("pending"))
                    .col(big_integer(Payment::Amount).default(0))
                    .col(string_len(Payment::Currency, 3).default("VND"))
                    .col(text(Payment::CreatedAt))
                    .col(text(Payment::UpdatedAt))
                    // Provider-specific transaction reference — unique per
                    // payment; the IPN/webhook looks the row up by it.
                    .col(string_len_uniq(Payment::ProviderTxnRef, 64))
                    .col(string_len_null(Payment::ProviderTransId, 64))
                    // Hosted checkout URL (VNPay/MoMo/ZaloPay); empty for
                    // VietQR/COD.
                    .col(text_null(Payment::GatewayUrl))
                    // VietQR: full EMV QR TLV string (CRC included).
                    .col(text_null(Payment::QrPayload))
                    .col(text_null(Payment::Memo))
                    // Last provider response (IPN payload, error) — audit
                    // only, never parsed by application logic.
                    .col(text_null(Payment::ProviderResponse))
                    .col(text_null(Payment::FailureReason))
                    // Who initiated the payment (kept for audit even if
                    // the booking is later cancelled).
                    .col(uuid_null(Payment::CreatedBy))
                    // COD: when the driver/agent collected the cash + who
                    // marked it collected.
                    .col(text_null(Payment::CollectedAt))
                    .col(uuid_null(Payment::CollectedBy))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_payment_booking")
                            .from(Payment::Table, Payment::BookingId)
                            .to(Booking::Table, Booking::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_payment_user")
                            .from(Payment::Table, Payment::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        for (idx, cols) in [
            ("Payment_bookingId_idx", vec![Payment::BookingId]),
            ("Payment_status_idx", vec![Payment::Status]),
            (
                "Payment_provider_status_idx",
                vec![Payment::Provider, Payment::Status],
            ),
            ("Payment_createdAt_idx", vec![Payment::CreatedAt]),
            (
                "Payment_bookingId_status_idx",
                vec![Payment::BookingId, Payment::Status],
            ),
        ] {
            let mut index = Index::create();
            index.name(idx).table(Payment::Table);
            for col in cols {
                index.col(col);
            }
            manager.create_index(index.to_owned()).await?;
        }

        // ── review ───────────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(Review::Table)
                    .col(pk_uuid(Review::Id))
                    .col(uuid_null(Review::BookingId))
                    .col(uuid_null(Review::TripSessionId))
                    .col(uuid_null(Review::RouteId))
                    .col(uuid_null(Review::BrandId))
                    .col(string_len_null(Review::AuthorName, 255))
                    .col(string_len_null(Review::AuthorPhone, 20))
                    .col(integer(Review::Rating))
                    .col(string_len_null(Review::Title, 255))
                    .col(text_null(Review::Content))
                    .col(text_null(Review::Tags))
                    .col(text_null(Review::Photos))
                    .col(string_len(Review::Status, 30).default("published"))
                    .col(integer(Review::HelpfulCount).default(0))
                    .col(text_null(Review::Reply))
                    .col(text_null(Review::RepliedAt))
                    .col(text(Review::CreatedAt))
                    .col(text(Review::UpdatedAt))
                    .col(uuid_null(Review::UserId))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_review_booking")
                            .from(Review::Table, Review::BookingId)
                            .to(Booking::Table, Booking::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_review_trip")
                            .from(Review::Table, Review::TripSessionId)
                            .to(TripSession::Table, TripSession::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_review_route")
                            .from(Review::Table, Review::RouteId)
                            .to(Route::Table, Route::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_review_brand")
                            .from(Review::Table, Review::BrandId)
                            .to(Brand::Table, Brand::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_review_user")
                            .from(Review::Table, Review::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        for (idx, cols) in [
            ("Review_routeId_idx", vec![Review::RouteId]),
            ("Review_brandId_idx", vec![Review::BrandId]),
            ("Review_status_idx", vec![Review::Status]),
            ("Review_userId_idx", vec![Review::UserId]),
            (
                "Review_routeId_createdAt_idx",
                vec![Review::RouteId, Review::CreatedAt],
            ),
            (
                "Review_brandId_createdAt_idx",
                vec![Review::BrandId, Review::CreatedAt],
            ),
            (
                "Review_status_createdAt_idx",
                vec![Review::Status, Review::CreatedAt],
            ),
        ] {
            let mut index = Index::create();
            index.name(idx).table(Review::Table);
            for col in cols {
                index.col(col);
            }
            manager.create_index(index.to_owned()).await?;
        }

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Reverse dependency order.
        for table in [
            Review::Table.into_iden(),
            Payment::Table.into_iden(),
            SeatInventory::Table.into_iden(),
            BookingSeat::Table.into_iden(),
            Booking::Table.into_iden(),
        ] {
            manager
                .drop_table(Table::drop().table(table).if_exists().cascade().to_owned())
                .await?;
        }
        Ok(())
    }
}

// ── Iden enums ──────────────────────────────────────────────────────────

/// Minimal references to tables created by earlier migrations — keeps
/// this migration self-contained.
#[derive(DeriveIden)]
enum User {
    Table,
    Id,
}

#[derive(DeriveIden)]
enum TripSession {
    Table,
    Id,
}

#[derive(DeriveIden)]
enum PickupPoint {
    Table,
    Id,
}

#[derive(DeriveIden)]
enum Campaign {
    Table,
    Id,
}

#[derive(DeriveIden)]
enum Seat {
    Table,
    Id,
}

#[derive(DeriveIden)]
enum Route {
    Table,
    Id,
}

#[derive(DeriveIden)]
enum Brand {
    Table,
    Id,
}

#[derive(DeriveIden)]
enum Booking {
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
enum BookingSeat {
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
enum SeatInventory {
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

#[derive(DeriveIden)]
enum Payment {
    Table,
    Id,
    BookingId,
    UserId,
    Provider,
    Status,
    Amount,
    Currency,
    CreatedAt,
    UpdatedAt,
    ProviderTxnRef,
    ProviderTransId,
    GatewayUrl,
    QrPayload,
    Memo,
    ProviderResponse,
    FailureReason,
    CreatedBy,
    CollectedAt,
    CollectedBy,
}

#[derive(DeriveIden)]
enum Review {
    Table,
    Id,
    BookingId,
    TripSessionId,
    RouteId,
    BrandId,
    AuthorName,
    AuthorPhone,
    Rating,
    Title,
    Content,
    Tags,
    Photos,
    Status,
    HelpfulCount,
    Reply,
    RepliedAt,
    CreatedAt,
    UpdatedAt,
    UserId,
}
