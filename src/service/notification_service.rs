//! Notification service — business logic for listing + marking-as-read.
//!
//! Thin wrapper around the `NotificationStore`. The service layer owns
//! input validation (id format, ownership) and maps raw entity rows
//! to typed DTOs from [`crate::dto::notification`].

use std::sync::Arc;

use chrono::Utc;
use sea_orm::Set;
use uuid::Uuid;

use crate::dto::notification::{
    MarkNotificationsReadResponse, NotificationListResponse, NotificationOut,
};
use crate::entity::notification;
use crate::error::{AppError, AppResult};
use crate::store::CompositeStore;

pub struct NotificationService {
    store: Arc<CompositeStore>,
}

impl NotificationService {
    pub fn new(store: Arc<CompositeStore>) -> Self {
        Self { store }
    }

    /// List the authenticated user's notifications, newest first.
    pub async fn list(
        &self,
        user_id: Uuid,
        limit: u64,
        offset: u64,
    ) -> AppResult<NotificationListResponse> {
        let limit = limit.clamp(1, 200);
        let uid_str = user_id.to_string();
        let items = self
            .store
            .notification_store()
            .list_by_user(&uid_str, limit, offset)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let total = self
            .store
            .notification_store()
            .count_by_user(&uid_str)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let unread_count = self
            .store
            .notification_store()
            .count_unread(&uid_str)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let items: Vec<NotificationOut> = items.into_iter().map(notification_to_dto).collect();
        Ok(NotificationListResponse {
            items,
            total,
            unread_count,
            limit,
            offset,
        })
    }

    /// Mark a set of notifications as read for the given user. When
    /// `ids` is empty, marks ALL of the user's notifications as read.
    pub async fn mark_read(
        &self,
        user_id: Uuid,
        ids: Vec<Uuid>,
    ) -> AppResult<MarkNotificationsReadResponse> {
        let uid_str = user_id.to_string();
        let updated = if ids.is_empty() {
            self.store
                .notification_store()
                .mark_all_read(&uid_str)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?
        } else {
            self.store
                .notification_store()
                .mark_many_read(&uid_str, &ids)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?
        };
        Ok(MarkNotificationsReadResponse { ok: true, updated })
    }

    /// Insert a new notification (used by internal callers — booking
    /// confirmations, price-drop alerts, etc.). Returns the stored model.
    pub async fn create(
        &self,
        user_id: Uuid,
        kind: &str,
        title: Option<&str>,
        body: Option<&str>,
        data: Option<&str>,
    ) -> AppResult<notification::Model> {
        let id = Uuid::new_v4();
        let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        let model = notification::ActiveModel {
            id: Set(id),
            user_id: Set(user_id),
            r#type: Set(kind.to_string()),
            title: Set(title.map(|s| s.to_string())),
            body: Set(body.map(|s| s.to_string())),
            data: Set(data.map(|s| s.to_string())),
            read: Set(false),
            created_at: Set(now),
        };
        self.store
            .notification_store()
            .insert(model)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))
    }
}

/// Map a `notification::Model` row to the `NotificationOut` DTO.
fn notification_to_dto(n: notification::Model) -> NotificationOut {
    NotificationOut {
        id: n.id,
        user_id: n.user_id,
        kind: n.r#type,
        title: n.title,
        body: n.body,
        data: n.data,
        read: n.read,
        created_at: n.created_at,
    }
}
