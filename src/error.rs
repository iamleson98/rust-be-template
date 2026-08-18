//! Unified error type that converts to HTTP responses.
//!
//! All handlers return [`Result<T, AppError>`]. Variants map to specific
//! HTTP status codes and JSON error bodies — see [`AppError::status`] and
//! [`AppError::into_response`].

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;
use thiserror::Error;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("resource not found: {0}")]
    NotFound(String),

    #[error("validation failed: {0}")]
    Validation(String),

    #[error("unauthorized: {0}")]
    Unauthorized(String),

    #[error("forbidden: missing permission: {0}")]
    Forbidden(String),

    #[error("conflict: {0}")]
    Conflict(String),

    #[error("bad request: {0}")]
    BadRequest(String),

    #[error("store error: {0}")]
    Store(#[from] crate::store::StoreError),

    #[error("cache error: {0}")]
    Cache(String),

    #[error("storage error: {0}")]
    Storage(String),

    #[error("worker error: {0}")]
    Worker(String),

    #[error("auth error: {0}")]
    Auth(String),

    #[error("resource gone: {0}")]
    Gone(String),

    #[error("service unavailable: {0}")]
    ServiceUnavailable(String),

    #[error("too many requests: {0}")]
    TooManyRequests(String),

    #[error("internal error: {0}")]
    Internal(String),
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    error: &'static str,
    message: String,
}

impl AppError {
    fn status(&self) -> StatusCode {
        match self {
            AppError::NotFound(_) => StatusCode::NOT_FOUND,
            AppError::Validation(_) | AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
            AppError::Unauthorized(_) | AppError::Auth(_) => StatusCode::UNAUTHORIZED,
            AppError::Forbidden(_) => StatusCode::FORBIDDEN,
            AppError::Conflict(_) => StatusCode::CONFLICT,
            AppError::Store(e) => match e {
                crate::store::StoreError::NotFound(_) => StatusCode::NOT_FOUND,
                crate::store::StoreError::Validation(_) => StatusCode::BAD_REQUEST,
                crate::store::StoreError::Forbidden(_) => StatusCode::FORBIDDEN,
                crate::store::StoreError::Conflict(_) => StatusCode::CONFLICT,
                crate::store::StoreError::Exhausted { .. } => StatusCode::SERVICE_UNAVAILABLE,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            },
            AppError::Cache(_) | AppError::Storage(_) | AppError::Worker(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
            AppError::Gone(_) => StatusCode::GONE,
            AppError::ServiceUnavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
            AppError::TooManyRequests(_) => StatusCode::TOO_MANY_REQUESTS,
            AppError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    fn kind(&self) -> &'static str {
        match self {
            AppError::NotFound(_) => "not_found",
            AppError::Validation(_) => "validation_error",
            AppError::BadRequest(_) => "bad_request",
            AppError::Unauthorized(_) | AppError::Auth(_) => "unauthorized",
            AppError::Forbidden(_) => "forbidden",
            AppError::Conflict(_) => "conflict",
            AppError::Store(_) => "store_error",
            AppError::Cache(_) => "cache_error",
            AppError::Storage(_) => "storage_error",
            AppError::Worker(_) => "worker_error",
            AppError::Gone(_) => "gone",
            AppError::ServiceUnavailable(_) => "service_unavailable",
            AppError::TooManyRequests(_) => "too_many_requests",
            AppError::Internal(_) => "internal_error",
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = self.status();
        let body = ErrorBody {
            error: self.kind(),
            message: self.to_string(),
        };
        // Differentiate log level by status family:
        // - 5xx (server errors) excluding 503: error — real signal for ops
        // - 429/503 (overload): warn — temporary, often recoverable
        // - 4xx (client errors): debug — these are expected and noisy at warn
        match status.as_u16() {
            429 | 503 => tracing::warn!(
                target: "app_error",
                kind = body.error,
                status = status.as_u16(),
                "{}",
                body.message
            ),
            500..=599 => tracing::error!(
                target: "app_error",
                kind = body.error,
                status = status.as_u16(),
                "{}",
                body.message
            ),
            _ => tracing::debug!(
                target: "app_error",
                kind = body.error,
                status = status.as_u16(),
                "{}",
                body.message
            ),
        }
        (status, Json(body)).into_response()
    }
}

/// Convenience trait so `?` works on anything that can become an [`AppError`].
pub trait IntoAppError<T> {
    fn map_app(self) -> AppResult<T>;
}

impl<T, E: std::fmt::Display> IntoAppError<T> for Result<T, E> {
    fn map_app(self) -> AppResult<T> {
        self.map_err(|e| AppError::Internal(e.to_string()))
    }
}
