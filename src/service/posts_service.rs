use std::sync::Arc;

use uuid::Uuid;

use crate::entity::posts;
use crate::error::{AppError, AppResult};
use crate::rbac::model::consts as rbac;
use crate::rbac::RbacChecker;
use crate::store::CompositeStore;

pub struct PostService {
    store: Arc<CompositeStore>,
    rbac: Arc<RbacChecker>,
}

impl PostService {
    pub fn new(store: Arc<CompositeStore>, rbac: Arc<RbacChecker>) -> Self {
        Self { store, rbac }
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

    /// Create a post. Caller must have `posts:write`.
    pub async fn create(
        &self,
        caller_id: Uuid,
        title: String,
        body: String,
    ) -> AppResult<posts::Model> {
        validate_post(&title, &body)?;
        self.rbac
            .require(caller_id, rbac::POSTS_WRITE)
            .await
            .map_err(AppError::from)?;
        Ok(self
            .store
            .post_store()
            .create_post(caller_id, title, body)
            .await?)
    }

    /// Update a post. Caller must have `posts:write`.
    pub async fn update(
        &self,
        caller_id: Uuid,
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
        self.rbac
            .require(caller_id, rbac::POSTS_WRITE)
            .await
            .map_err(AppError::from)?;
        Ok(self.store.post_store().update_post(id, title, body).await?)
    }

    /// Delete a post. Caller must have `posts:delete`.
    pub async fn delete(&self, caller_id: Uuid, id: Uuid) -> AppResult<()> {
        self.rbac
            .require(caller_id, rbac::POSTS_DELETE)
            .await
            .map_err(AppError::from)?;
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
