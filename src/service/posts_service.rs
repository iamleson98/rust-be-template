use std::sync::Arc;

use uuid::Uuid;

use crate::entity::posts;
use crate::error::{AppError, AppResult};
use crate::store::CompositeStore;

/// Post service — pure business logic, no auth knowledge.
///
/// Permission checks are done at the route handler layer via
/// `require_permission(&st, &auth_user.0, rbac::POSTS_WRITE).await?`.
pub struct PostService {
    store: Arc<CompositeStore>,
}

impl PostService {
    pub fn new(store: Arc<CompositeStore>) -> Self {
        Self { store }
    }

    /// List posts (paginated). Public read — no permission required.
    pub async fn list(&self, limit: u64, offset: u64) -> AppResult<Vec<posts::Model>> {
        // Clamp limit to prevent abuse.
        let limit = limit.min(100);
        Ok(self.store.post_store().list_posts(limit, offset).await?)
    }

    /// Get a single post. Public read.
    pub async fn get(&self, id: Uuid) -> AppResult<posts::Model> {
        Ok(self.store.post_store().get_post(id).await?)
    }

    /// Create a post. Permission check is at the route handler.
    pub async fn create(
        &self,
        author_id: Uuid,
        title: String,
        body: String,
    ) -> AppResult<posts::Model> {
        validate_post(&title, &body)?;
        Ok(self
            .store
            .post_store()
            .create_post(author_id, title, body)
            .await?)
    }

    /// Update a post. Permission check is at the route handler.
    pub async fn update(
        &self,
        id: Uuid,
        title: Option<String>,
        body: Option<String>,
    ) -> AppResult<posts::Model> {
        if let Some(ref t) = title {
            validate_title(t)?;
        }
        if let Some(ref b) = body {
            validate_body(b)?;
        }
        Ok(self.store.post_store().update_post(id, title, body).await?)
    }

    /// Delete a post. Permission check is at the route handler.
    pub async fn delete(&self, id: Uuid) -> AppResult<()> {
        self.store.post_store().delete_post(id).await?;
        Ok(())
    }
}

fn validate_post(title: &str, body: &str) -> AppResult<()> {
    validate_title(title)?;
    validate_body(body)?;
    Ok(())
}

fn validate_title(title: &str) -> AppResult<()> {
    if title.is_empty() || title.len() > 256 {
        return Err(AppError::Validation(
            "title must be 1-256 characters".into(),
        ));
    }
    Ok(())
}

fn validate_body(body: &str) -> AppResult<()> {
    if body.is_empty() {
        return Err(AppError::Validation("body must not be empty".into()));
    }
    Ok(())
}
