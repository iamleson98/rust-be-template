use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::error::AppError;
use crate::middleware::AuthUser;
use crate::service::booking_service::{CancelReq, ConfirmReq, HoldReq};
use crate::state::AppState;

#[derive(Deserialize)]
pub struct ListQuery { pub status: Option<String>, pub limit: Option<u64>, pub offset: Option<u64> }

pub async fn list(State(st): State<AppState>, AuthUser(uid): AuthUser, Query(q): Query<ListQuery>) -> Result<Json<Value>, AppError> {
    let status = q.status.unwrap_or_else(|| "all".into());
    let limit = q.limit.unwrap_or(20);
    let offset = q.offset.unwrap_or(0);
    Ok(Json(st.bookings.list(&uid.to_string(), &status, limit, offset).await?))
}

pub async fn hold(State(st): State<AppState>, AuthUser(_uid): AuthUser, Json(body): Json<HoldReq>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.bookings.hold(&body).await?))
}

#[derive(Deserialize)]
pub struct LookupQuery { pub phone: Option<String>, pub code: Option<String> }
pub async fn lookup(State(st): State<AppState>, Query(q): Query<LookupQuery>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.bookings.lookup(q.phone.as_deref(), q.code.as_deref()).await?))
}

pub async fn detail(State(st): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.bookings.detail(Some(&uid.to_string()), id).await?))
}

pub async fn cancel(State(st): State<AppState>, AuthUser(_uid): AuthUser, Path(id): Path<Uuid>, Json(body): Json<CancelReq>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.bookings.cancel(id, body.reason.as_deref()).await?))
}

pub async fn confirm(State(st): State<AppState>, AuthUser(_uid): AuthUser, Path(id): Path<Uuid>, Json(body): Json<ConfirmReq>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.bookings.confirm(id, &body.payment_method).await?))
}
