//! Admin — Cron job routes (`/api/admin/cron-jobs`).
//!
//! Recurring background jobs (e.g. the biweekly Vietnam OSM → Tantivy
//! refresh): status, next run, work time, history, manual triggering,
//! and schedule editing.

use axum::extract::{Path, Query, State};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use validator::Validate;

use crate::dto::admin::{
    CronJobListResponse, CronJobOut, CronJobRunListResponse, CronJobRunOut, CronJobRunsQuery,
    UpdateCronJobRequest,
};
use crate::error::AppError;
use crate::middleware::AdminUser;
use crate::rbac::model::consts as rbac;
use crate::state::AppState;

/// `GET /api/admin/cron-jobs` — schedules with next run + latest run.
#[utoipa::path(
    get,
    path = "/api/admin/cron-jobs",
    tag = "admin",
    responses(
        (status = 200, description = "Scheduled job list", body = CronJobListResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn list(
    State(st): State<AppState>,
    admin: AdminUser,
) -> Result<Json<CronJobListResponse>, AppError> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_CRON_JOBS_READ)
        .await?;
    Ok(Json(st.jobs.list_schedules().await?))
}

/// `GET /api/admin/cron-jobs/runs` — run history (most recent first).
#[utoipa::path(
    get,
    path = "/api/admin/cron-jobs/runs",
    tag = "admin",
    params(CronJobRunsQuery),
    responses(
        (status = 200, description = "Run history", body = CronJobRunListResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn list_runs(
    State(st): State<AppState>,
    admin: AdminUser,
    Query(q): Query<CronJobRunsQuery>,
) -> Result<Json<CronJobRunListResponse>, AppError> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_CRON_JOBS_READ)
        .await?;
    Ok(Json(
        st.jobs.list_runs(q.job_type.as_deref(), q.limit).await?,
    ))
}

/// `PATCH /api/admin/cron-jobs/{jobType}` — enable/disable, change the
/// cadence or fire time, or re-arm the next run.
#[utoipa::path(
    patch,
    path = "/api/admin/cron-jobs/{jobType}",
    tag = "admin",
    params(("jobType" = String, Path, description = "Job type (e.g. `osm.import`)")),
    request_body = UpdateCronJobRequest,
    responses(
        (status = 200, description = "Updated schedule", body = CronJobOut),
        (status = 400, description = "Bad request — invalid interval/hour/minute"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "No schedule for that job type"),
    )
)]
pub async fn update(
    State(st): State<AppState>,
    admin: AdminUser,
    Path(job_type): Path<String>,
    Json(body): Json<UpdateCronJobRequest>,
) -> Result<Json<CronJobOut>, AppError> {
    body.validate().map_err(AppError::from)?;
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_CRON_JOBS_WRITE)
        .await?;
    Ok(Json(st.jobs.update_schedule(&job_type, &body).await?))
}

/// `POST /api/admin/cron-jobs/{jobType}/trigger` — enqueue a run now.
#[utoipa::path(
    post,
    path = "/api/admin/cron-jobs/{jobType}/trigger",
    tag = "admin",
    params(("jobType" = String, Path, description = "Job type (e.g. `osm.import`)")),
    responses(
        (status = 200, description = "Run enqueued", body = CronJobRunOut),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "No schedule for that job type"),
        (status = 409, description = "Conflict — a run is already queued/running"),
        (status = 503, description = "Worker not running in this process"),
    )
)]
pub async fn trigger(
    State(st): State<AppState>,
    admin: AdminUser,
    Path(job_type): Path<String>,
) -> Result<Json<CronJobRunOut>, AppError> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_CRON_JOBS_WRITE)
        .await?;
    Ok(Json(st.jobs.trigger(&job_type).await?))
}

/// `POST /api/admin/cron-jobs/{jobType}/cancel` — kill the queued or
/// running run of a job (the admin "Dừng" button). Cancellation is
/// cooperative: the handler observes the token at its phase boundaries
/// and finalizes its own history row; the runner ACKs (no retry).
#[utoipa::path(
    post,
    path = "/api/admin/cron-jobs/{jobType}/cancel",
    tag = "admin",
    params(("jobType" = String, Path, description = "Job type (e.g. `osm.import`)")),
    responses(
        (status = 200, description = "Run cancelled (or already cancelled)", body = CronJobRunOut),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "No queued/running run for that job type"),
    )
)]
pub async fn cancel(
    State(st): State<AppState>,
    admin: AdminUser,
    Path(job_type): Path<String>,
) -> Result<Json<CronJobRunOut>, AppError> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_CRON_JOBS_WRITE)
        .await?;
    Ok(Json(st.jobs.cancel(&job_type).await?))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list))
        .route("/runs", get(list_runs))
        .route("/{job_type}", patch(update))
        .route("/{job_type}/trigger", post(trigger))
        .route("/{job_type}/cancel", post(cancel))
}
