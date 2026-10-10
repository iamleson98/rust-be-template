//! Discount campaigns: admins publish tiers of coupons ("X đ × N slots"),
//! customers claim one, it comes off a ticket, and the platform pays the
//! operator once the trip happened. See `docs/CAMPAIGNS.md`.
//!
//! * `discount_campaign` — the window (`starts_at`..`ends_at`), whether
//!   its coupons expire with it (`coupon_validity` = `campaign`) or never
//!   (`permanent`), and whether it covers every operator (`all_brands`).
//! * `discount_campaign_brand` — the operators of a campaign that does
//!   not cover them all.
//! * `discount_tier` — "amount × total_slots"; `claimed_slots` counts the
//!   coupons handed out and is only ever changed by conditional updates.
//! * `coupon` — one claimed slot. The database itself enforces the rules
//!   that money depends on:
//!   - `active_holder` is the owner while the coupon is `held` or
//!     `reserved` and NULL otherwise; unique, so an account holds at
//!     most one coupon at a time (NULLs never collide);
//!   - `(campaign_id, user_id)` is unique: one coupon per account per
//!     campaign;
//!   - `booking_id` is unique: one coupon per booking.
//!
//! The retired typed promo codes (`campaign`) stay for the bookings that
//! reference them.
//!
//! Also grants `admin:campaigns:manage` to the `admin` role only.

use sea_orm::{ConnectionTrait, TryGetable};
use sea_orm_migration::{prelude::*, schema::*};
use uuid::Uuid;

#[derive(DeriveMigrationName)]
pub struct Migration;

const PERM_NAME: &str = "admin:campaigns:manage";
const PERM_DESC: &str = "Admin: create/edit discount campaigns, review and settle coupon payouts";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(DiscountCampaign::Table)
                    .col(pk_uuid(DiscountCampaign::Id))
                    .col(string_len(DiscountCampaign::Name, 120))
                    .col(text_null(DiscountCampaign::Description))
                    .col(text(DiscountCampaign::StartsAt))
                    .col(text(DiscountCampaign::EndsAt))
                    .col(string_len(DiscountCampaign::CouponValidity, 16))
                    .col(boolean(DiscountCampaign::AllBrands).default(true))
                    .col(boolean(DiscountCampaign::Paused).default(false))
                    .col(uuid_null(DiscountCampaign::CreatedBy))
                    .col(text(DiscountCampaign::CreatedAt))
                    .col(text(DiscountCampaign::UpdatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_discount_campaign_created_by")
                            .from(DiscountCampaign::Table, DiscountCampaign::CreatedBy)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::SetNull),
                    )
                    .to_owned(),
            )
            .await?;
        // The home page asks for campaigns that have not ended yet.
        index(
            manager,
            DiscountCampaign::Table,
            "idx_discount_campaign_ends_at",
            &[DiscountCampaign::EndsAt],
            false,
        )
        .await?;

        manager
            .create_table(
                Table::create()
                    .table(DiscountCampaignBrand::Table)
                    .col(uuid(DiscountCampaignBrand::CampaignId))
                    .col(uuid(DiscountCampaignBrand::BrandId))
                    .primary_key(
                        Index::create()
                            .col(DiscountCampaignBrand::CampaignId)
                            .col(DiscountCampaignBrand::BrandId),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_discount_campaign_brand_campaign")
                            .from(
                                DiscountCampaignBrand::Table,
                                DiscountCampaignBrand::CampaignId,
                            )
                            .to(DiscountCampaign::Table, DiscountCampaign::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_discount_campaign_brand_brand")
                            .from(DiscountCampaignBrand::Table, DiscountCampaignBrand::BrandId)
                            .to(Brand::Table, Brand::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        index(
            manager,
            DiscountCampaignBrand::Table,
            "idx_discount_campaign_brand_brand",
            &[DiscountCampaignBrand::BrandId],
            false,
        )
        .await?;

        manager
            .create_table(
                Table::create()
                    .table(DiscountTier::Table)
                    .col(pk_uuid(DiscountTier::Id))
                    .col(uuid(DiscountTier::CampaignId))
                    .col(big_integer(DiscountTier::Amount))
                    .col(integer(DiscountTier::TotalSlots))
                    .col(integer(DiscountTier::ClaimedSlots).default(0))
                    .col(small_integer(DiscountTier::Position).default(0))
                    .col(text(DiscountTier::CreatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_discount_tier_campaign")
                            .from(DiscountTier::Table, DiscountTier::CampaignId)
                            .to(DiscountCampaign::Table, DiscountCampaign::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        // One tier per amount within a campaign.
        index(
            manager,
            DiscountTier::Table,
            "idx_discount_tier_campaign_amount",
            &[DiscountTier::CampaignId, DiscountTier::Amount],
            true,
        )
        .await?;

        manager
            .create_table(
                Table::create()
                    .table(Coupon::Table)
                    .col(pk_uuid(Coupon::Id))
                    .col(string_len(Coupon::Code, 16))
                    .col(uuid(Coupon::CampaignId))
                    .col(uuid(Coupon::TierId))
                    .col(uuid_null(Coupon::UserId))
                    .col(big_integer(Coupon::Amount))
                    .col(string_len(Coupon::Status, 12))
                    .col(uuid_null(Coupon::ActiveHolder))
                    .col(text_null(Coupon::ValidUntil))
                    .col(uuid_null(Coupon::BookingId))
                    .col(uuid_null(Coupon::BrandId))
                    .col(string_len_null(Coupon::ClaimIp, 64))
                    .col(text(Coupon::ClaimedAt))
                    .col(text_null(Coupon::ReservedAt))
                    .col(text_null(Coupon::RedeemedAt))
                    .col(text_null(Coupon::SettledAt))
                    .col(uuid_null(Coupon::SettledBy))
                    .col(text_null(Coupon::SettlementNote))
                    .col(text(Coupon::UpdatedAt))
                    // A campaign or tier with coupons cannot be deleted:
                    // the coupons are the payout ledger.
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_coupon_campaign")
                            .from(Coupon::Table, Coupon::CampaignId)
                            .to(DiscountCampaign::Table, DiscountCampaign::Id)
                            .on_delete(ForeignKeyAction::Restrict),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_coupon_tier")
                            .from(Coupon::Table, Coupon::TierId)
                            .to(DiscountTier::Table, DiscountTier::Id)
                            .on_delete(ForeignKeyAction::Restrict),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_coupon_user")
                            .from(Coupon::Table, Coupon::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::SetNull),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_coupon_booking")
                            .from(Coupon::Table, Coupon::BookingId)
                            .to(Booking::Table, Booking::Id)
                            .on_delete(ForeignKeyAction::SetNull),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_coupon_brand")
                            .from(Coupon::Table, Coupon::BrandId)
                            .to(Brand::Table, Brand::Id)
                            .on_delete(ForeignKeyAction::SetNull),
                    )
                    .to_owned(),
            )
            .await?;
        index(
            manager,
            Coupon::Table,
            "idx_coupon_code",
            &[Coupon::Code],
            true,
        )
        .await?;
        index(
            manager,
            Coupon::Table,
            "idx_coupon_active_holder",
            &[Coupon::ActiveHolder],
            true,
        )
        .await?;
        index(
            manager,
            Coupon::Table,
            "idx_coupon_campaign_user",
            &[Coupon::CampaignId, Coupon::UserId],
            true,
        )
        .await?;
        index(
            manager,
            Coupon::Table,
            "idx_coupon_booking",
            &[Coupon::BookingId],
            true,
        )
        .await?;
        index(
            manager,
            Coupon::Table,
            "idx_coupon_campaign_status",
            &[Coupon::CampaignId, Coupon::Status],
            false,
        )
        .await?;
        index(
            manager,
            Coupon::Table,
            "idx_coupon_status_brand",
            &[Coupon::Status, Coupon::BrandId],
            false,
        )
        .await?;
        index(
            manager,
            Coupon::Table,
            "idx_coupon_tier",
            &[Coupon::TierId],
            false,
        )
        .await?;

        grant_admin_permission(manager).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .exec_stmt(
                Query::delete()
                    .from_table(Permissions::Table)
                    .and_where(Expr::col(Permissions::Name).eq(PERM_NAME))
                    .to_owned(),
            )
            .await?;
        for table in [
            Coupon::Table.into_iden(),
            DiscountTier::Table.into_iden(),
            DiscountCampaignBrand::Table.into_iden(),
            DiscountCampaign::Table.into_iden(),
        ] {
            manager
                .drop_table(Table::drop().table(table).if_exists().to_owned())
                .await?;
        }
        Ok(())
    }
}

async fn index<T: IntoIden + Copy + 'static, C: IntoIden + Copy + 'static>(
    manager: &SchemaManager<'_>,
    table: T,
    name: &str,
    cols: &[C],
    unique: bool,
) -> Result<(), DbErr> {
    let mut idx = Index::create();
    idx.name(name).table(table);
    for col in cols {
        idx.col(*col);
    }
    if unique {
        idx.unique();
    }
    manager.create_index(idx.to_owned()).await
}

/// The id of the first row `select` returns, if any.
async fn first_id(
    manager: &SchemaManager<'_>,
    select: SelectStatement,
) -> Result<Option<Uuid>, DbErr> {
    let db = manager.get_connection();
    let row = db
        .query_one(db.get_database_backend().build(&select))
        .await?;
    row.map(|r| Uuid::try_get(&r, "", "id").map_err(|e| DbErr::Custom(format!("{e:?}"))))
        .transpose()
}

/// Ensure `admin:campaigns:manage` exists and only `admin` holds it.
/// Idempotent: an existing row or grant is left alone.
async fn grant_admin_permission(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    let find_perm = Query::select()
        .column(Permissions::Id)
        .from(Permissions::Table)
        .and_where(Expr::col(Permissions::Name).eq(PERM_NAME))
        .to_owned();
    let perm_id = match first_id(manager, find_perm.clone()).await? {
        Some(id) => id,
        None => {
            let id = Uuid::new_v4();
            manager
                .exec_stmt(
                    Query::insert()
                        .into_table(Permissions::Table)
                        .columns([
                            Permissions::Id,
                            Permissions::Name,
                            Permissions::Description,
                            Permissions::CreatedAt,
                        ])
                        .values_panic([
                            id.into(),
                            PERM_NAME.into(),
                            PERM_DESC.into(),
                            Expr::current_timestamp().into(),
                        ])
                        .to_owned(),
                )
                .await?;
            id
        }
    };

    let find_role = Query::select()
        .column(Roles::Id)
        .from(Roles::Table)
        .and_where(Expr::col(Roles::Name).eq("admin"))
        .to_owned();
    let Some(role_id) = first_id(manager, find_role).await? else {
        // No roles yet (the seed has not run): the seed grants admins everything.
        return Ok(());
    };
    let has_grant = Query::select()
        .expr_as(Expr::col(RolePermissions::RoleId), Alias::new("id"))
        .from(RolePermissions::Table)
        .and_where(Expr::col(RolePermissions::RoleId).eq(role_id))
        .and_where(Expr::col(RolePermissions::PermissionId).eq(perm_id))
        .to_owned();
    if first_id(manager, has_grant).await?.is_none() {
        manager
            .exec_stmt(
                Query::insert()
                    .into_table(RolePermissions::Table)
                    .columns([
                        RolePermissions::RoleId,
                        RolePermissions::PermissionId,
                        RolePermissions::AssignedAt,
                    ])
                    .values_panic([
                        role_id.into(),
                        perm_id.into(),
                        Expr::current_timestamp().into(),
                    ])
                    .to_owned(),
            )
            .await?;
    }
    Ok(())
}

#[derive(DeriveIden, Clone, Copy)]
enum DiscountCampaign {
    Table,
    Id,
    Name,
    Description,
    StartsAt,
    EndsAt,
    CouponValidity,
    AllBrands,
    Paused,
    CreatedBy,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden, Clone, Copy)]
enum DiscountCampaignBrand {
    Table,
    CampaignId,
    BrandId,
}

#[derive(DeriveIden, Clone, Copy)]
enum DiscountTier {
    Table,
    Id,
    CampaignId,
    Amount,
    TotalSlots,
    ClaimedSlots,
    Position,
    CreatedAt,
}

#[derive(DeriveIden, Clone, Copy)]
enum Coupon {
    Table,
    Id,
    Code,
    CampaignId,
    TierId,
    UserId,
    Amount,
    Status,
    ActiveHolder,
    ValidUntil,
    BookingId,
    BrandId,
    ClaimIp,
    ClaimedAt,
    ReservedAt,
    RedeemedAt,
    SettledAt,
    SettledBy,
    SettlementNote,
    UpdatedAt,
}

#[derive(DeriveIden, Clone, Copy)]
enum User {
    Table,
    Id,
}

#[derive(DeriveIden, Clone, Copy)]
enum Brand {
    Table,
    Id,
}

#[derive(DeriveIden, Clone, Copy)]
enum Booking {
    Table,
    Id,
}

#[derive(DeriveIden)]
enum Permissions {
    Table,
    Id,
    Name,
    Description,
    CreatedAt,
}

#[derive(DeriveIden)]
enum Roles {
    Table,
    Id,
    Name,
}

#[derive(DeriveIden)]
enum RolePermissions {
    Table,
    RoleId,
    PermissionId,
    AssignedAt,
}
