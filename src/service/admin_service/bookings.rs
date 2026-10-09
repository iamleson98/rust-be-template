//! Booking management: list, detail, status changes, stats and CSV export.

use std::collections::BTreeMap;

use chrono::Utc;
use sea_orm::Set;
use uuid::Uuid;

use super::{now_iso, AdminService};
use crate::dto::admin::{
    AdminBookingDayBucket, AdminBookingDetailResponse, AdminBookingExportResponse,
    AdminBookingListResponse, AdminBookingStatsResponse, AdminBookingTotals, AdminBookingsQuery,
    UpdateBookingStatusRequest,
};
use crate::entity::{audit_log, booking};
use crate::error::{AppError, AppResult};
use crate::payment::providers;
use crate::service::booking_view::{booking_view, booking_views, departure_of};
use crate::service::trip_time;
use crate::store::{BookingFilter, BookingOrder, ConfirmOutcome};

impl AdminService {
    /// A page of the tickets `q` selects: placed tickets only (no unfinished
    /// checkouts), by status, brand, route, search and booking days.
    pub async fn list_bookings(
        &self,
        q: &AdminBookingsQuery,
    ) -> AppResult<AdminBookingListResponse> {
        let (limit, offset) = (q.limit.unwrap_or(50).min(200), q.offset.unwrap_or(0));
        let filter = admin_filter(q)?;
        let store = self.store.booking_store();
        let total = store.count_bookings(&filter).await?;
        let bookings = store.list_bookings(&filter, limit, offset).await?;
        Ok(AdminBookingListResponse {
            items: booking_views(&self.store, bookings).await?,
            total,
            limit,
            offset,
        })
    }

    pub async fn get_booking(&self, id: Uuid) -> AppResult<AdminBookingDetailResponse> {
        let b = self.find_booking(id).await?;
        Ok(AdminBookingDetailResponse {
            item: booking_view(&self.store, b).await?,
        })
    }

    /// Staff move a ticket on: confirm it after phoning the customer
    /// (`pending` → `confirmed`, the seats become booked), mark it
    /// `completed` after the trip, or cancel it (the seats go back on sale).
    /// Completed and cancelled tickets are final.
    pub async fn update_booking_status(
        &self,
        actor: Uuid,
        id: Uuid,
        body: &UpdateBookingStatusRequest,
    ) -> AppResult<AdminBookingDetailResponse> {
        let b = self.find_booking(id).await?;
        let store = self.store.booking_store();
        match (b.status.as_str(), body.status.as_str()) {
            ("completed" | "cancelled", _) => {
                return Err(AppError::Conflict(format!(
                    "ticket {} is {} and can no longer change",
                    b.code, b.status
                )))
            }
            ("pending", "confirmed") => {
                let method = b.payment_method.as_deref().unwrap_or(providers::COD);
                match store.confirm_pending(id, method).await? {
                    ConfirmOutcome::Confirmed => {}
                    ConfirmOutcome::NotPending => return Err(changed()),
                    ConfirmOutcome::SeatsLost => {
                        return Err(AppError::Gone(
                            "the seats of this booking were already released".into(),
                        ))
                    }
                }
            }
            ("confirmed", "completed") => {
                // Completing is final, so only once the trip has actually left.
                if departure_of(&self.store, &b)
                    .await?
                    .is_some_and(|departs| departs > Utc::now())
                {
                    return Err(AppError::BadRequest(
                        "the trip has not left yet; complete the ticket after departure".into(),
                    ));
                }
                if !store.complete_booking(id).await? {
                    return Err(changed());
                }
            }
            ("pending" | "confirmed", "cancelled") => {
                store
                    .cancel_booking(id, &["pending", "confirmed"])
                    .await?
                    .ok_or_else(changed)?;
            }
            (from, to) => {
                return Err(AppError::BadRequest(format!(
                    "a {from} ticket cannot become {to}"
                )))
            }
        }

        // Who did it and why, for the record (best-effort).
        let _ = self
            .store
            .audit_store()
            .insert_audit_log(audit_log::ActiveModel {
                id: Set(Uuid::new_v4()),
                actor_type: Set(Some("staff".to_string())),
                actor_id: Set(Some(actor)),
                action: Set(format!("booking_{}", body.status)),
                target_type: Set(Some("booking".to_string())),
                target_id: Set(Some(id)),
                metadata: Set(body.reason.clone()),
                created_at: Set(now_iso()),
                ..Default::default()
            })
            .await;

        self.get_booking(id).await
    }

    async fn find_booking(&self, id: Uuid) -> AppResult<booking::Model> {
        self.store
            .booking_store()
            .find_booking_by_id(id)
            .await?
            .ok_or_else(|| AppError::NotFound("booking not found".into()))
    }

    /// Ticket counts and revenue for the tickets `q` selects, overall and
    /// per Vietnamese calendar day. Revenue is what confirmed and completed
    /// tickets bring in.
    pub async fn booking_stats(
        &self,
        q: &AdminBookingsQuery,
    ) -> AppResult<AdminBookingStatsResponse> {
        let facts = self
            .store
            .booking_store()
            .booking_facts(&admin_filter(q)?)
            .await?;
        let mut totals = Tally::default();
        let mut by_day: BTreeMap<String, Tally> = BTreeMap::new();
        for (created_at, status, total) in &facts {
            totals.add(status, *total);
            if let Some(day) = trip_time::local_date(created_at) {
                by_day.entry(day).or_default().add(status, *total);
            }
        }
        Ok(AdminBookingStatsResponse {
            totals: AdminBookingTotals {
                total: totals.count,
                revenue: totals.revenue,
                confirmed: totals.confirmed,
                cancelled: totals.cancelled,
                completed: totals.completed,
                pending: totals.pending,
            },
            by_day: by_day
                .into_iter()
                .map(|(date, d)| AdminBookingDayBucket {
                    date,
                    count: d.count,
                    revenue: d.revenue,
                    confirmed: d.confirmed,
                    cancelled: d.cancelled,
                    completed: d.completed,
                    pending: d.pending,
                })
                .collect(),
        })
    }

    /// Export bookings as CSV.
    ///
    /// Uses streaming pagination (1000 rows per page) to avoid loading
    /// the entire booking table into memory at once. At 100k bookings
    /// the previous approach would use ~50MB of RAM per export request.
    pub async fn booking_export(
        &self,
        q: &AdminBookingsQuery,
    ) -> AppResult<AdminBookingExportResponse> {
        let filter = admin_filter(q)?;
        let col_list: Vec<String> = EXPORT_COLUMNS.iter().map(|c| c.to_string()).collect();

        // CSV with UTF-8 BOM (Excel-friendly)
        let mut csv = String::from('\u{feff}');
        csv.push_str(&col_list.join(","));
        csv.push('\n');

        let mut total_count = 0usize;
        let mut offset = 0u64;
        const PAGE: u64 = 1000;
        loop {
            let bookings = self
                .store
                .booking_store()
                .list_bookings(&filter, PAGE, offset)
                .await?;
            if bookings.is_empty() {
                break;
            }
            for b in &bookings {
                let mut row: Vec<String> = Vec::with_capacity(col_list.len());
                for col in &col_list {
                    let val: String = match col.as_str() {
                        "code" => b.code.clone(),
                        "status" => b.status.clone(),
                        "contactName" => b.contact_name.clone().unwrap_or_default(),
                        "contactPhone" => b.contact_phone.clone().unwrap_or_default(),
                        "total" => b.total.to_string(),
                        "paymentMethod" => b.payment_method.clone().unwrap_or_default(),
                        "createdAt" => b.created_at.clone(),
                        _ => String::new(),
                    };
                    row.push(format!("\"{}\"", val.replace('"', "\"\"")));
                }
                csv.push_str(&row.join(","));
                csv.push('\n');
            }
            total_count += bookings.len();
            offset += PAGE;
            if (bookings.len() as u64) < PAGE {
                break;
            }
        }

        Ok(AdminBookingExportResponse {
            csv,
            count: total_count,
            columns: col_list,
            filename: format!("bookings_export_{}.csv", Utc::now().format("%Y%m%d_%H%M%S")),
        })
    }
}

fn changed() -> AppError {
    AppError::Conflict("the booking was changed by another request".into())
}

const EXPORT_COLUMNS: [&str; 7] = [
    "code",
    "status",
    "contactName",
    "contactPhone",
    "total",
    "paymentMethod",
    "createdAt",
];

/// What an admin listing selects: tickets only (no unfinished checkouts) by
/// `status` (or `awaiting`: pay-on-board tickets waiting for the phone call),
/// brand, route, search and the Vietnamese calendar days `date_from..=date_to`
/// they were booked on, in the `sort` order.
fn admin_filter(q: &AdminBookingsQuery) -> AppResult<BookingFilter> {
    let status = q
        .status
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != "all");
    let awaiting = status == Some("awaiting");
    // The start of `date`, `days_later` days on, as stored timestamps read.
    let day_start = |date: &Option<String>, days_later: i64| -> AppResult<Option<String>> {
        date.as_deref()
            .map(str::trim)
            .filter(|d| !d.is_empty())
            .map(|d| {
                trip_time::local_day_start(d)
                    .map(|t| {
                        (t + chrono::Duration::days(days_later))
                            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
                    })
                    .ok_or_else(|| AppError::BadRequest(format!("{d} is not a YYYY-MM-DD date")))
            })
            .transpose()
    };
    Ok(BookingFilter {
        status: if awaiting {
            Some("pending".into())
        } else {
            status.map(str::to_string)
        },
        payment_method: awaiting.then(|| providers::COD.to_string()),
        placed: true,
        search: q.search.clone(),
        brand_id: q.brand_id,
        route_id: q.route_id,
        created_from: day_start(&q.date_from, 0)?,
        created_before: day_start(&q.date_to, 1)?,
        order: match q.sort.as_deref() {
            Some("created_asc") => BookingOrder::OldestFirst,
            Some("total_desc") => BookingOrder::TotalDesc,
            Some("total_asc") => BookingOrder::TotalAsc,
            _ => BookingOrder::NewestFirst,
        },
        ..Default::default()
    })
}

/// Tickets by status, and the revenue the confirmed and completed ones bring.
#[derive(Default)]
struct Tally {
    count: i64,
    revenue: i64,
    confirmed: i64,
    cancelled: i64,
    completed: i64,
    pending: i64,
}

impl Tally {
    fn add(&mut self, status: &str, total: i64) {
        self.count += 1;
        match status {
            "confirmed" => {
                self.confirmed += 1;
                self.revenue += total;
            }
            "completed" => {
                self.completed += 1;
                self.revenue += total;
            }
            "cancelled" => self.cancelled += 1,
            _ => self.pending += 1,
        }
    }
}
