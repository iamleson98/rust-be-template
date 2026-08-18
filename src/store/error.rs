use thiserror::Error;

pub type StoreResult<T> = Result<T, StoreError>;

#[derive(Debug, Clone, Error)]
pub enum StoreError {
    #[error("entity not found: {0}")]
    NotFound(String),

    #[error("database error: {0}")]
    Database(String),

    #[error("validation error: {0}")]
    Validation(String),

    #[error("forbidden: {0}")]
    Forbidden(String),

    #[error("conflict: {0}")]
    Conflict(String),

    /// Returned by the retry layer once all attempts are exhausted.
    #[error("operation failed after {retries} retries: {source}")]
    Exhausted {
        retries: usize,
        source: Box<StoreError>,
    },
}

impl StoreError {
    /// Whether the error is worth retrying. Transient DB hiccups return
    /// `true`; logical errors (`NotFound`, `Validation`, `Forbidden`,
    /// `Conflict`, `Exhausted`) return `false`.
    pub fn is_retryable(&self) -> bool {
        match self {
            StoreError::Database(_) => true,
            StoreError::NotFound(_) => false,
            StoreError::Validation(_) => false,
            StoreError::Forbidden(_) => false,
            StoreError::Conflict(_) => false,
            StoreError::Exhausted { .. } => false,
        }
    }
}

impl From<sea_orm::DbErr> for StoreError {
    fn from(e: sea_orm::DbErr) -> Self {
        // Heuristic: sea-orm's RecordNotFound is non-retryable; everything
        // else (connection errors, serialization failures, deadlocks) we
        // treat as retryable. Tune as needed.
        if matches!(e, sea_orm::DbErr::RecordNotFound(_)) {
            StoreError::NotFound(e.to_string())
        } else {
            StoreError::Database(e.to_string())
        }
    }
}

impl From<anyhow::Error> for StoreError {
    fn from(e: anyhow::Error) -> Self {
        // Try to downcast to a StoreError first (preserves structured variants).
        if let Some(store_err) = e.downcast_ref::<StoreError>() {
            return store_err.clone();
        }
        // Otherwise, treat as a generic database error.
        StoreError::Database(e.to_string())
    }
}
