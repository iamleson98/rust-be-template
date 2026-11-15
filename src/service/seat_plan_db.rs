//! Database side of seat plans — shared by the admin API and the
//! `layouts-normalize` CLI so both change a layout the same way.
//!
//! Writes run DIRECTLY on the transaction (entity ops on `tx`): going
//! through the store methods would check out a SECOND pooled connection
//! and wait for the transaction's own write lock.

use std::collections::HashMap;
use std::sync::Arc;

use sea_orm::sea_query::Expr;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set, Unchanged,
};
use uuid::Uuid;

use crate::db::write::with_write;
use crate::dto::seat_plan::SeatPlan;
use crate::entity::{bus_layout, seat};
use crate::service::seat_plan::{self, SeatSpec, SeatSync};
use crate::store::{ScheduleStore, StoreResult};

/// Trips were created on this layout (their capacity is its seat count;
/// seat rows follow on demand) or tickets sold from its seats: the seat
/// set is frozen, seats may only be moved or relabelled.
pub async fn layout_in_use(store: &dyn ScheduleStore, layout_id: Uuid) -> StoreResult<bool> {
    if store.count_trips_by_bus_layout(layout_id).await? > 0 {
        return Ok(true);
    }
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

/// What [`apply_plan`] writes, owned so the transaction body can run again.
struct PlanWrite {
    old_labels: HashMap<Uuid, String>,
    deletes: Vec<Uuid>,
    updates: Vec<(Uuid, SeatSpec)>,
    inserts: Vec<SeatSpec>,
    total_seats: i16,
    layout_data: String,
    now: String,
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
) -> StoreResult<()> {
    // The transaction body may run more than once and cannot borrow the
    // caller's data, so it works on one owned copy.
    let write = Arc::new(PlanWrite {
        old_labels: existing
            .iter()
            .map(|s| (s.id, s.seat_label.clone()))
            .collect(),
        deletes: sync.deletes.clone(),
        updates: sync.updates.clone(),
        inserts: sync.inserts.clone(),
        total_seats: seat_plan::sellable_count(plan) as i16,
        layout_data: seat_plan::to_stored(plan),
        now: now.to_string(),
    });
    with_write(db, |tx| {
        let w = write.clone();
        Box::pin(async move {
            if !w.deletes.is_empty() {
                seat::Entity::delete_many()
                    .filter(seat::Column::Id.is_in(w.deletes.clone()))
                    .exec(tx)
                    .await?;
            }
            // (seat_label is UNIQUE per layout.) Park every relabelled seat on a
            // throwaway label first so swaps and shifts never collide.
            for (seat_id, spec) in &w.updates {
                if w.old_labels[seat_id] != spec.label {
                    let parked = format!("~{}", &seat_id.simple().to_string()[..8]);
                    seat::Entity::update_many()
                        .col_expr(seat::Column::SeatLabel, Expr::value(parked))
                        .filter(seat::Column::Id.eq(*seat_id))
                        .exec(tx)
                        .await?;
                }
            }
            for (seat_id, spec) in &w.updates {
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
                .update(tx)
                .await?;
            }
            if !w.inserts.is_empty() {
                let fresh: Vec<_> = w
                    .inserts
                    .iter()
                    .map(|s| new_seat(layout_id, s, &w.now))
                    .collect();
                seat::Entity::insert_many(fresh).exec(tx).await?;
            }
            bus_layout::ActiveModel {
                id: Unchanged(layout_id),
                total_seats: Set(Some(w.total_seats)),
                layout_data: Set(Some(w.layout_data.clone())),
                updated_at: Set(w.now.clone()),
                ..Default::default()
            }
            .update(tx)
            .await?;
            Ok(())
        })
    })
    .await
}
