//! `SeaORM` Entity for the `payment` table.
//!
//! A `payment` row represents a single payment attempt for a booking.
//! Multiple attempts may exist for the same booking (e.g. the user tried
//! MoMo, it timed out, then they switched to VNPay). Only one row per
//! booking can be in the `pending` state at any time — enforced by the
//! application layer, not by a unique constraint (so we can keep history
//! of failed/cancelled attempts).
//!
//! The provider-side transaction reference (`provider_txn_ref`) IS unique
//! — it's the key the gateway uses to find this row in the IPN callback.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "payment")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    #[sea_orm(column_type = "Text")]
    pub booking_id: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub user_id: Option<String>,
    /// `vnpay` | `momo` | `zalopay` | `vietqr` | `cod`.
    pub provider: String,
    /// `pending` | `completed` | `failed` | `cancelled` | `refunded`.
    pub status: String,
    /// Amount in the smallest currency unit (VND: integer đồng).
    /// Always positive; refunds are tracked as separate rows.
    pub amount: i64,
    pub currency: String,
    #[sea_orm(column_type = "Text")]
    pub created_at: String,
    #[sea_orm(column_type = "Text")]
    pub updated_at: String,
    /// Unique per payment — the gateway uses it as the order id / `vnp_TxnRef`.
    #[sea_orm(unique)]
    #[sea_orm(column_type = "Text")]
    pub provider_txn_ref: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub provider_trans_id: Option<String>,
    /// For VNPay/MoMo/ZaloPay: hosted checkout URL.
    /// For VietQR/COD: `None` (use `qr_payload` instead).
    #[sea_orm(column_type = "Text", nullable)]
    pub gateway_url: Option<String>,
    /// For VietQR: the full EMV QR TLV string (CRC included).
    /// For other providers: `None`.
    #[sea_orm(column_type = "Text", nullable)]
    pub qr_payload: Option<String>,
    /// Memo / `addInfo` embedded in the QR (VietQR `addInfo`,
    /// VNPay `vnp_OrderInfo`). Used for bank-transfer reconciliation.
    #[sea_orm(column_type = "Text", nullable)]
    pub memo: Option<String>,
    /// JSON-serialised last provider response (IPN payload, error, ...).
    /// Stored for audit — never inspected by application logic.
    #[sea_orm(column_type = "Text", nullable)]
    pub provider_response: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub failure_reason: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub created_by: Option<String>,
    /// For COD: when the driver/agent collected the cash.
    #[sea_orm(column_type = "Text", nullable)]
    pub collected_at: Option<String>,
    /// For COD: which admin user marked the payment as collected.
    #[sea_orm(column_type = "Text", nullable)]
    pub collected_by: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::booking::Entity",
        from = "Column::BookingId",
        to = "super::booking::Column::Id",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    Booking,
    #[sea_orm(
        belongs_to = "super::user::Entity",
        from = "Column::UserId",
        to = "super::user::Column::Id",
        on_update = "Cascade",
        on_delete = "SetNull"
    )]
    User,
}

impl Related<super::booking::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Booking.def()
    }
}

impl Related<super::user::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::User.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

// ────────────────────────────────────────────────────────────────
//  Domain constants — kept here so they live next to the entity they
//  constrain. The route + service layers import from here.
// ────────────────────────────────────────────────────────────────

/// Allowed values for `payment.provider`.
pub mod providers {
    pub const VNPAY: &str = "vnpay";
    pub const MOMO: &str = "momo";
    pub const ZALOPAY: &str = "zalopay";
    pub const VIETQR: &str = "vietqr";
    pub const COD: &str = "cod";

    /// All providers in alphabetical order — used by the validation layer.
    pub const ALL: &[&str] = &[MOMO, VNPAY, ZALOPAY, COD, VIETQR];

    /// Providers that require an online gateway (redirect to hosted checkout).
    /// Excludes `vietqr` (rendered as QR locally) and `cod` (offline).
    pub const ONLINE: &[&str] = &[MOMO, VNPAY, ZALOPAY];
}

/// Allowed values for `payment.status`.
pub mod statuses {
    /// Awaiting gateway confirmation (IPN) or QR scan + manual reconcile.
    pub const PENDING: &str = "pending";
    /// Gateway confirmed the payment — booking is now `confirmed`.
    pub const COMPLETED: &str = "completed";
    /// Gateway returned a failure (rejected card, expired wallet, ...).
    /// Booking remains `pending` until the user retries.
    pub const FAILED: &str = "failed";
    /// User / system cancelled before completion (booking expiry, manual).
    pub const CANCELLED: &str = "cancelled";
    /// Refund issued post-completion (separate flow, refund_amount > 0).
    pub const REFUNDED: &str = "refunded";

    pub const ALL: &[&str] = &[PENDING, COMPLETED, FAILED, CANCELLED, REFUNDED];

    /// True if the status represents a terminal state (no further transitions).
    pub fn is_terminal(status: &str) -> bool {
        matches!(status, COMPLETED | FAILED | CANCELLED | REFUNDED)
    }

    /// True if the status represents a state where money was successfully collected.
    pub fn is_paid(status: &str) -> bool {
        matches!(status, COMPLETED | REFUNDED)
    }
}
