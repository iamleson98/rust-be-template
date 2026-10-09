//! Booking management: list, detail, status changes, stats and CSV export.

use std::collections::BTreeMap;

use chrono::Utc;
use sea_orm::Set;
use uuid::Uuid;

use super::{now_iso, AdminService};
use crate::dto::admin::{
    AdminBookingDayBucket, AdminBookingDetail, AdminBookingDetailResponse,
    AdminBookingExportResponse, AdminBookingListResponse, AdminBookingOut, AdminBookingSeatOut,
    AdminBookingStatsResponse, AdminBookingStatusUpdate, AdminBookingTotals,
    UpdateBookingStatusRequest, UpdateBookingStatusResponse,
};
use crate::entity::{audit_log, booking};
use crate::error::{AppError, AppResult};

impl AdminService {
    /// List bookings with admin filters.
    #[allow(clippy::too_many_arguments)]
    pub async fn list_bookings(
        &self,
        status: Option<&str>,
        _brand_id: Option<&str>,
        _route_id: Option<&str>,
        _date_from: Option<&str>,
        _date_to: Option<&str>,
        _search: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> AppResult<AdminBookingListResponse> {
        let limit = limit.min(200);
        // Total matching-row count (independent of the window) — the
        // admin tickets table needs it to render "Hiển thị X–Y / N" and
        // to enable the next/previous page buttons.
        let total = self
            .store
            .booking_store()
            .count_bookings_by_status(status)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        // Note: brand_id, route_id, date_from, date_to, search filters are
        // not supported by the current BookingStore trait; only status is.
        // For full admin filtering, the store trait would need extension.
        let bookings = self
            .store
            .booking_store()
            .list_bookings_by_status(status, limit, offset)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Previously: `let total = bookings.len();` — that's the page size
        // (capped by `limit`), NOT the matching-row count, so pagination
        // showed "Showing 1-50 of 50" on every page. Now omit `total` from
        // the response until the store gets a proper count_bookings_by_filter
        // method (tracked separately).
        let items: Vec<AdminBookingOut> = bookings
            .iter()
            .map(|b| AdminBookingOut {
                id: b.id,
                code: b.code.clone(),
                status: b.status.clone(),
                total: b.total,
                currency: b.currency.clone(),
                contact_name: b.contact_name.clone(),
                contact_phone: b.contact_phone.clone(),
                contact_email: b.contact_email.clone(),
                payment_method: b.payment_method.clone(),
                pickup_name: b.pickup_name.clone(),
                dropoff_name: b.dropoff_name.clone(),
                created_at: b.created_at.clone(),
                updated_at: b.updated_at.clone(),
                expires_at: b.expires_at.clone(),
            })
            .collect();

        Ok(AdminBookingListResponse {
            items,
            total: Some(total),
            limit,
            offset,
        })
    }

    /// Get a single booking by id (admin view with full detail).
    pub async fn get_booking(&self, id: Uuid) -> AppResult<AdminBookingDetailResponse> {
        let b = self
            .store
            .booking_store()
            .find_booking_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("booking not found".into()))?;

        // Fetch booking seats
        let seats = self
            .store
            .booking_store()
            .list_booking_seats(&b.id.to_string())
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let seats_out: Vec<AdminBookingSeatOut> = seats
            .iter()
            .map(|bs| AdminBookingSeatOut {
                seat_id: Some(bs.seat_id.to_string()),
                price: bs.price,
                passenger_name: bs.passenger_name.clone(),
                passenger_type: bs.passenger_type.clone(),
                passenger_age: bs.passenger_age,
            })
            .collect();

        Ok(AdminBookingDetailResponse {
            item: AdminBookingDetail {
                id: b.id,
                code: b.code,
                status: b.status,
                subtotal: b.subtotal,
                discount: b.discount,
                fees: b.fees,
                total: b.total,
                currency: b.currency,
                contact_name: b.contact_name,
                contact_phone: b.contact_phone,
                contact_email: b.contact_email,
                payment_method: b.payment_method,
                pickup_name: b.pickup_name,
                dropoff_name: b.dropoff_name,
                created_at: b.created_at,
                updated_at: b.updated_at,
                expires_at: b.expires_at,
                seats: seats_out,
            },
        })
    }

    /// Update booking status (admin override with state machine validation).
    pub async fn update_booking_status(
        &self,
        id: Uuid,
        body: &UpdateBookingStatusRequest,
    ) -> AppResult<UpdateBookingStatusResponse> {
        let new_status = body.status.as_str();
        let valid = [
            "pending",
            "confirmed",
            "paid",
            "completed",
            "cancelled",
            "refunded",
        ];
        if !valid.contains(&new_status) {
            return Err(AppError::BadRequest("invalid booking status".into()));
        }

        // Normalize paid → confirmed
        let canonical = if new_status == "paid" {
            "confirmed".to_string()
        } else if new_status == "refunded" {
            "cancelled".to_string()
        } else {
            new_status.to_string()
        };

        let existing = self
            .store
            .booking_store()
            .find_booking_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("booking not found".into()))?;

        if existing.status == canonical {
            return Ok(UpdateBookingStatusResponse {
                item: AdminBookingStatusUpdate {
                    id,
                    status: existing.status,
                    previous_status: Some(new_status.to_string()),
                    updated_at: existing.updated_at.clone(),
                },
                reason: body.reason.clone(),
            });
        }

        // Validate the transition
        if !body.force {
            let allowed = matches!(
                (existing.status.as_str(), canonical.as_str()),
                ("pending", "confirmed")
                    | ("pending", "cancelled")
                    | ("confirmed", "completed")
                    | ("confirmed", "cancelled")
                    | ("completed", "cancelled")
                    | ("refunded", "cancelled")
                    | ("cancelled", "refunded")
            );
            if !allowed {
                return Err(AppError::BadRequest(format!(
                    "cannot transition from '{}' to '{}'. Use force=true for admin override.",
                    existing.status, canonical
                )));
            }
        }

        let now = now_iso();
        let mut active: booking::ActiveModel = existing.into();
        active.status = Set(canonical.clone());
        active.updated_at = Set(now.clone());
        self.store
            .booking_store()
            .update_booking(active)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Audit log (best-effort)
        let audit_id = Uuid::new_v4();
        let audit_model = audit_log::ActiveModel {
            id: Set(audit_id),
            action: Set(format!("booking_status_{canonical}")),
            target_type: Set(Some("booking".to_string())),
            target_id: Set(Some(id)),
            metadata: Set(body.reason.clone()),
            ..Default::default()
        };
        let _ = self.store.audit_store().insert_audit_log(audit_model).await;

        Ok(UpdateBookingStatusResponse {
            item: AdminBookingStatusUpdate {
                id,
                status: canonical,
                previous_status: Some(new_status.to_string()),
                updated_at: now,
            },
            reason: body.reason.clone(),
        })
    }

    /// Compute booking stats (totals, by-day, by-brand breakdowns).
    pub async fn booking_stats(
        &self,
        status: Option<&str>,
        _date_from: Option<&str>,
        _date_to: Option<&str>,
    ) -> AppResult<AdminBookingStatsResponse> {
        // SQL-side aggregation — replaces the previous "load ALL bookings
        // into memory and iterate in Rust" pattern that would OOM at scale.
        // Two queries: one for status totals, one for per-day breakdown.
        use crate::entity::booking;
        use sea_orm::sea_query::Expr;
        use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QuerySelect};

        // ── Status totals: SELECT status, COUNT(*), SUM(total) GROUP BY status
        let mut totals_q = booking::Entity::find().select_only();
        totals_q = totals_q
            .column(booking::Column::Status)
            .column_as(Expr::col(booking::Column::Id).count(), "count")
            .column_as(Expr::col(booking::Column::Total).sum(), "revenue")
            .group_by(booking::Column::Status);
        if let Some(s) = status {
            if s != "all" {
                totals_q = totals_q.filter(booking::Column::Status.eq(s.to_string()));
            }
        }
        let totals_rows: Vec<(String, i64, Option<i64>)> = totals_q
            .into_tuple::<(String, i64, Option<i64>)>()
            .all(self.store.db())
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let mut total = 0i64;
        let mut revenue = 0i64;
        let mut confirmed = 0i64;
        let mut cancelled = 0i64;
        let mut completed = 0i64;
        let mut pending = 0i64;
        for (st, count, rev) in &totals_rows {
            total += count;
            revenue += rev.unwrap_or(0);
            match st.as_str() {
                "confirmed" | "paid" => confirmed += count,
                "cancelled" => cancelled += count,
                "completed" => completed += count,
                _ => pending += count,
            }
        }

        // ── Per-day breakdown: fetch only created_at + status + total
        // (3 columns instead of the full row) and aggregate in Rust.
        // At 10k+ bookings this is ~3x smaller payload than loading full
        // rows. A proper SQL GROUP BY DATE(created_at) would be even
        // better but requires dialect-specific SUBSTR/DATE handling.
        let mut day_q = booking::Entity::find()
            .select_only()
            .column(booking::Column::CreatedAt)
            .column(booking::Column::Status)
            .column(booking::Column::Total);
        if let Some(s) = status {
            if s != "all" {
                day_q = day_q.filter(booking::Column::Status.eq(s.to_string()));
            }
        }
        let day_rows: Vec<(String, String, Option<i64>)> = day_q
            .into_tuple::<(String, String, Option<i64>)>()
            .all(self.store.db())
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let mut by_day: BTreeMap<String, DayBucket> = BTreeMap::new();
        for (created_at, st, total_val) in &day_rows {
            let day = created_at.get(..10).unwrap_or("").to_string();
            if day.is_empty() {
                continue;
            }
            let entry = by_day.entry(day).or_default();
            entry.count += 1;
            entry.revenue += total_val.unwrap_or(0);
            match st.as_str() {
                "confirmed" | "paid" => entry.confirmed += 1,
                "cancelled" => entry.cancelled += 1,
                "completed" => entry.completed += 1,
                _ => entry.pending += 1,
            }
        }

        let by_day_vec: Vec<AdminBookingDayBucket> = by_day
            .iter()
            .map(|(day, b)| AdminBookingDayBucket {
                date: day.clone(),
                count: b.count,
                revenue: b.revenue,
                confirmed: b.confirmed,
                cancelled: b.cancelled,
                completed: b.completed,
                pending: b.pending,
            })
            .collect();

        Ok(AdminBookingStatsResponse {
            totals: AdminBookingTotals {
                total,
                revenue,
                confirmed,
                cancelled,
                completed,
                pending,
            },
            by_day: by_day_vec,
        })
    }

    /// Export bookings as CSV.
    ///
    /// Uses streaming pagination (1000 rows per page) to avoid loading
    /// the entire booking table into memory at once. At 100k bookings
    /// the previous approach would use ~50MB of RAM per export request.
    pub async fn booking_export(
        &self,
        status: Option<&str>,
        _date_from: Option<&str>,
        _date_to: Option<&str>,
        columns: Option<&str>,
    ) -> AppResult<AdminBookingExportResponse> {
        let col_list: Vec<String> = columns
            .map(|s| {
                s.split(',')
                    .map(|x| x.trim().to_string())
                    .filter(|x| !x.is_empty())
                    .collect()
            })
            .unwrap_or_else(|| {
                [
                    "code",
                    "status",
                    "contactName",
                    "contactPhone",
                    "total",
                    "paymentMethod",
                    "createdAt",
                ]
                .iter()
                .map(|s| s.to_string())
                .collect()
            });

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
                .list_bookings_by_status(status, PAGE, offset)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?;
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

#[derive(Default)]
struct DayBucket {
    count: i64,
    revenue: i64,
    confirmed: i64,
    cancelled: i64,
    completed: i64,
    pending: i64,
}
