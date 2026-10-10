//! Database side of seat plans — shared by the admin API and the
//! `layouts-normalize` CLI so both change a layout the same way.
//!
//! Writes run DIRECTLY on the transaction (entity ops on `&txn`): going
//! through the store methods would check out a SECOND pooled connection
//! and deadlock on SQLite's table lock.

use std::collections::HashMap;

use sea_orm::sea_query::Expr;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, DbErr, EntityTrait, QueryFilter, Set,
    TransactionTrait, Unchanged,
};
use uuid::Uuid;

use crate::dto::seat_plan::SeatPlan;
use crate::entity::{bus_layout, seat};
use crate::service::seat_plan::{self, SeatSpec, SeatSync};
use crate::store::{ScheduleStore, StoreResult};

/// Trips have been materialized (or tickets sold) from this layout's
/// seats: the seat set is frozen, seats may only be moved or relabelled.
pub async fn layout_in_use(store: &dyn ScheduleStore, layout_id: Uuid) -> StoreResult<bool> {
    let inventory = store.count_seat_inventory_by_bus_layout(layout_id).await?;
    let sold = store.count_booking_seats_by_bus_layout(layout_id).await?;
    Ok(inventory + sold > 0)
}

pub fn new_seat(layout_id: Uuid, spec: &SeatSpec, now: &str) -> seat::ActiveModel {
    seat::ActiveModel {
        id: Set(Uuid::new_v4()),
        bus_layout_id: Set(layout_id),
        seat_label: Set(spec.label.clone()),
        seat_class: Set(spec.class.clone()),
        row_num: Set(Some(spec.row)),
        col_num: Set(Some(spec.col)),
        is_window: Set(spec.is_window),
        floor: Set(spec.floor),
        created_at: Set(now.to_string()),
    }
}

/// Make the layout's `seat` rows and stored plan match `plan`, in one
/// transaction. `sync` is [`seat_plan::sync_seats`]'s verdict for
/// `existing`; kept seats keep their ids.
pub async fn apply_plan(
    db: &DatabaseConnection,
    layout_id: Uuid,
    plan: &SeatPlan,
    existing: &[seat::Model],
    sync: &SeatSync,
    now: &str,
) -> Result<(), DbErr> {
    let old: HashMap<Uuid, &seat::Model> = existing.iter().map(|s| (s.id, s)).collect();
    let txn = db.begin().await?;
    if !sync.deletes.is_empty() {
        seat::Entity::delete_many()
            .filter(seat::Column::Id.is_in(sync.deletes.clone()))
            .exec(&txn)
            .await?;
    }
    // (seat_label is UNIQUE per layout.) Park every relabelled seat on a
    // throwaway label first so swaps and shifts never collide.
    for (seat_id, spec) in &sync.updates {
        if old[seat_id].seat_label != spec.label {
            let parked = format!("~{}", &seat_id.simple().to_string()[..8]);
            seat::Entity::update_many()
                .col_expr(seat::Column::SeatLabel, Expr::value(parked))
                .filter(seat::Column::Id.eq(*seat_id))
                .exec(&txn)
                .await?;
        }
    }
    for (seat_id, spec) in &sync.updates {
        seat::ActiveModel {
            id: Unchanged(*seat_id),
            seat_label: Set(spec.label.clone()),
            seat_class: Set(spec.class.clone()),
            row_num: Set(Some(spec.row)),
            col_num: Set(Some(spec.col)),
            is_window: Set(spec.is_window),
            floor: Set(spec.floor),
            ..Default::default()
        }
        .update(&txn)
        .await?;
    }
    if !sync.inserts.is_empty() {
        let fresh: Vec<_> = sync
            .inserts
            .iter()
            .map(|s| new_seat(layout_id, s, now))
            .collect();
        seat::Entity::insert_many(fresh).exec(&txn).await?;
    }
    bus_layout::ActiveModel {
        id: Unchanged(layout_id),
        total_seats: Set(Some(seat_plan::sellable_count(plan) as i16)),
        layout_data: Set(Some(seat_plan::to_stored(plan))),
        updated_at: Set(now.to_string()),
        ..Default::default()
    }
    .update(&txn)
    .await?;
    txn.commit().await
}
