use sea_orm_migration::{prelude::*, schema::*};

use crate::migration::m20250101_000001_create_users::User;
use crate::migration::m20260809_020741_bookings::Booking;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden)]
pub enum Payment {
    Table,
    Id,
    BookingId,
    UserId,
    // Provider: vnpay | momo | zalopay | vietqr | cod
    Provider,
    // Internal state machine: pending → completed | failed | cancelled | refunded
    Status,
    // Amount in smallest currency unit (VND: integer đồng). Always positive.
    Amount,
    Currency,
    // ISO-8601 timestamp string (consistent with the rest of the codebase).
    CreatedAt,
    UpdatedAt,
    // Provider-specific transaction reference (vnp_TxnRef / orderId / app_trans_id).
    // Unique per payment — the IPN/webhook uses it to look up the payment.
    ProviderTxnRef,
    // Provider-side transaction id (vnp_TransactionNo / transId / zp_trans_id).
    // Populated only after the IPN confirms the payment.
    ProviderTransId,
    // For VNPay/MoMo/ZaloPay: the hosted checkout URL the user is redirected to.
    // For VietQR: empty (the QR is rendered from `qr_payload`).
    // For COD: empty.
    GatewayUrl,
    // For VietQR: the full EMV QR TLV string (CRC included).
    // For VNPay/MoMo/ZaloPay: empty (use gateway_url instead).
    QrPayload,
    // Optional memo embedded in the QR (VietQR `addInfo` / VNPay `vnp_OrderInfo`).
    // Used to reconcile bank transfers + provider IPNs.
    Memo,
    // JSON blob with the last provider response (IPN payload, error, etc.).
    // Stored for audit + debugging — never inspected by application logic.
    ProviderResponse,
    // Optional failure reason (human-readable Vietnamese / English).
    FailureReason,
    // Who initiated the payment — captured at creation time for audit even
    // if the booking is later cancelled.
    CreatedBy,
    // For COD: when the driver/agent collected the cash.
    CollectedAt,
    // For COD: who marked the payment as collected (admin user id).
    CollectedBy,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Payment::Table)
                    .if_not_exists()
                    .col(pk_uuid(Payment::Id))
                    .col(text(Payment::BookingId))
                    .col(text_null(Payment::UserId))
                    .col(string_len(Payment::Provider, 16))
                    .col(string_len(Payment::Status, 16).default("pending"))
                    .col(big_integer(Payment::Amount).default(0))
                    .col(string_len(Payment::Currency, 3).default("VND"))
                    .col(text(Payment::CreatedAt))
                    .col(text(Payment::UpdatedAt))
                    .col(string_len_uniq(Payment::ProviderTxnRef, 64))
                    .col(string_len_null(Payment::ProviderTransId, 64))
                    .col(text_null(Payment::GatewayUrl))
                    .col(text_null(Payment::QrPayload))
                    .col(text_null(Payment::Memo))
                    .col(text_null(Payment::ProviderResponse))
                    .col(text_null(Payment::FailureReason))
                    .col(text_null(Payment::CreatedBy))
                    .col(text_null(Payment::CollectedAt))
                    .col(text_null(Payment::CollectedBy))
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

        // Lookups: by booking, by status, by provider, by collected state.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("Payment_bookingId_idx")
                    .table(Payment::Table)
                    .col(Payment::BookingId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("Payment_status_idx")
                    .table(Payment::Table)
                    .col(Payment::Status)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("Payment_provider_status_idx")
                    .table(Payment::Table)
                    .col(Payment::Provider)
                    .col(Payment::Status)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("Payment_createdAt_idx")
                    .table(Payment::Table)
                    .col(Payment::CreatedAt)
                    .to_owned(),
            )
            .await?;
        // Single active-payment lookup: at most one row per booking with
        // status in (pending). Used by the create-payment route to detect
        // duplicate attempts and by the IPN to find the row to update.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("Payment_bookingId_status_idx")
                    .table(Payment::Table)
                    .col(Payment::BookingId)
                    .col(Payment::Status)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Payment::Table).cascade().to_owned())
            .await?;
        Ok(())
    }
}
