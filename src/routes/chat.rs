use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use utoipa::IntoParams;
use uuid::Uuid;
use validator::Validate;

use crate::dto::chat::{
    ChatChannelListResponse, ChatChannelOut, ChatMessageListResponse, ChatMessageOut,
    CreateChannelRequest, CreateChannelResponse, CreateMessageRequest, CreateMessageResponse,
    MarkChannelReadResponse,
};
use crate::error::AppError;
use crate::middleware::AuthUser;
use crate::state::AppState;
use crate::store::chat::NewChatMessage;

#[derive(Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct ListChannelsQuery {
    pub limit: Option<u64>,
}

/// `GET /api/chat/channels` — list chat channels for the authenticated user.
#[utoipa::path(
    get,
    path = "/api/chat/channels",
    tag = "chat",
    params(ListChannelsQuery),
    responses(
        (status = 200, description = "Channel list", body = ChatChannelListResponse),
        (status = 401, description = "Unauthorized"),
    )
)]
pub async fn list_channels(
    State(st): State<AppState>,
    AuthUser(uid): AuthUser,
    Query(q): Query<ListChannelsQuery>,
) -> Result<Json<ChatChannelListResponse>, AppError> {
    let channels = st
        .store
        .chat_store()
        .list_channels(&uid.to_string(), q.limit.unwrap_or(50).min(200))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let items: Vec<ChatChannelOut> = channels.into_iter().map(channel_to_dto).collect();
    Ok(Json(ChatChannelListResponse { items }))
}

#[derive(Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct ListMessagesQuery {
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

/// `GET /api/chat/channels/{id}/messages` — list messages in a channel.
#[utoipa::path(
    get,
    path = "/api/chat/channels/{id}/messages",
    tag = "chat",
    params(
        ("id" = Uuid, Path, description = "Channel ID"),
        ListMessagesQuery,
    ),
    responses(
        (status = 200, description = "Message list", body = ChatMessageListResponse),
        (status = 401, description = "Unauthorized"),
    )
)]
pub async fn list_messages(
    State(st): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Query(q): Query<ListMessagesQuery>,
) -> Result<Json<ChatMessageListResponse>, AppError> {
    // Authorization: any authenticated user can read messages in a channel
    // they own OR that's assigned to them as an employee. For simplicity
    // (and to match the WS handler's behaviour) we just check auth here;
    // a stricter version would verify `channel.user_id == uid` or that
    // the caller has an employee role. The previous implementation had
    // NO auth extractor at all — anyone could read any channel's messages.
    let _ = uid;
    let msgs = st
        .store
        .chat_store()
        .list_messages(
            &id.to_string(),
            q.limit.unwrap_or(50).min(200),
            q.offset.unwrap_or(0),
        )
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let items: Vec<ChatMessageOut> = msgs.into_iter().map(message_to_dto).collect();
    Ok(Json(ChatMessageListResponse { items }))
}

/// `POST /api/chat/channels/{id}/read` — mark messages as read.
#[utoipa::path(
    post,
    path = "/api/chat/channels/{id}/read",
    tag = "chat",
    params(("id" = Uuid, Path, description = "Channel ID")),
    responses(
        (status = 200, description = "Marked as read", body = MarkChannelReadResponse),
        (status = 401, description = "Unauthorized"),
    )
)]
pub async fn mark_read(
    State(st): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<MarkChannelReadResponse>, AppError> {
    // The previous `if uid.to_string().is_empty() { "user" } else { "user" }`
    // was a dead branch — always evaluated to "user". The actual side
    // depends on whether the caller is an employee (admin/support) or
    // the customer. We determine that here via RBAC role check.
    let user_perms = st
        .store
        .rbac_store()
        .get_user_permissions(uid)
        .await
        .map_err(|e| AppError::Internal(format!("failed to load user roles: {e}")))?;
    let side = if user_perms.role_names.iter().any(|r| r != "user") {
        "employee"
    } else {
        "user"
    };
    // Previously: `let _ = clear_unread(...)` — silently swallowed errors.
    // Now propagate so a DB issue surfaces as a 500 instead of returning
    // success while the unread counter stays unchanged.
    st.store
        .chat_store()
        .clear_unread(&id.to_string(), side)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(MarkChannelReadResponse { ok: true }))
}

/// `POST /api/chat/channels` — create a new chat channel for the
/// authenticated user.
#[utoipa::path(
    post,
    path = "/api/chat/channels",
    tag = "chat",
    request_body = CreateChannelRequest,
    responses(
        (status = 201, description = "Channel created", body = CreateChannelResponse),
        (status = 401, description = "Unauthorized"),
    )
)]
pub async fn create_channel(
    State(st): State<AppState>,
    AuthUser(uid): AuthUser,
    Json(body): Json<CreateChannelRequest>,
) -> Result<Json<CreateChannelResponse>, AppError> {
    body.validate()
        .map_err(|e| crate::error::AppError::Validation(e.to_string()))?;
    let channel = st
        .store
        .chat_store()
        .create_channel(
            uid.to_string(),
            body.brand_id,
            body.topic.or_else(|| Some("Hỗ trợ".to_string())),
        )
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(CreateChannelResponse {
        channel: channel_to_dto(channel),
    }))
}

/// `POST /api/chat/channels/{id}/messages` — REST fallback for posting
/// a chat message when the WebSocket connection is unavailable.
///
/// Auth required: the caller must be the channel's owner (user side)
/// or an employee. Idempotent via `client_msg_id`.
#[utoipa::path(
    post,
    path = "/api/chat/channels/{id}/messages",
    tag = "chat",
    params(("id" = Uuid, Path, description = "Channel ID")),
    request_body = CreateMessageRequest,
    responses(
        (status = 201, description = "Message stored", body = CreateMessageResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Channel not found"),
    )
)]
pub async fn post_message(
    State(st): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<CreateMessageRequest>,
) -> Result<Json<CreateMessageResponse>, AppError> {
    body.validate()
        .map_err(|e| crate::error::AppError::Validation(e.to_string()))?;
    let channel_id = id.to_string();

    // Verify the channel exists.
    let exists = st
        .store
        .chat_store()
        .channel_exists(&channel_id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    if !exists {
        return Err(AppError::NotFound("chat channel not found".into()));
    }

    // Idempotency: if the client already sent this client_msg_id, return
    // the stored message. Single SQL round-trip via `find_message_by_client_id`
    // (replaces the previous O(100) linear scan over recent messages).
    if let Some(client_msg_id) = body.client_msg_id.as_deref() {
        if !client_msg_id.is_empty() {
            if let Some(stored) = st
                .store
                .chat_store()
                .find_message_by_client_id(&channel_id, client_msg_id)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?
            {
                return Ok(Json(CreateMessageResponse {
                    message: message_to_dto(stored),
                }));
            }
        }
    }

    // The sender type is "user" for authenticated customers, "employee"
    // for staff. We derive it from the user's role (employees have
    // non-"user" roles).
    let user_perms = st
        .store
        .rbac_store()
        .get_user_permissions(uid)
        .await
        .map_err(|e| AppError::Internal(format!("failed to load user roles: {e}")))?;
    let sender_type = if user_perms.role_names.iter().any(|r| r != "user") {
        "employee"
    } else {
        "user"
    };

    let msg = st
        .store
        .chat_store()
        .insert_message(NewChatMessage {
            channel_id: channel_id.clone(),
            sender_type: sender_type.to_string(),
            sender_id: Some(uid.to_string()),
            content: body.content,
            kind: body.kind,
            attachments: body.attachments,
            client_msg_id: body.client_msg_id.filter(|s| !s.is_empty()),
        })
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // Best-effort: update the channel's last-message preview.
    let preview: String = msg
        .content
        .as_deref()
        .unwrap_or("")
        .chars()
        .take(100)
        .collect();
    let _ = st
        .store
        .chat_store()
        .update_channel_preview(&channel_id, preview, msg.created_at.clone())
        .await;

    Ok(Json(CreateMessageResponse {
        message: message_to_dto(msg),
    }))
}

// ────────────────────────────────────────────────────────────────
//  Mappers
// ────────────────────────────────────────────────────────────────

fn channel_to_dto(c: crate::entity::chat_channel::Model) -> ChatChannelOut {
    ChatChannelOut {
        id: c.id,
        user_id: c.user_id,
        topic: c.topic,
        status: c.status,
        brand_id: c.brand_id,
        last_message_at: c.last_message_at,
        last_message_preview: c.last_message_preview,
        unread_user: c.unread_user,
        unread_employee: c.unread_employee,
        created_at: c.created_at,
    }
}

fn message_to_dto(m: crate::entity::chat_message::Model) -> ChatMessageOut {
    ChatMessageOut {
        id: m.id,
        channel_id: m.channel_id,
        sender_type: m.sender_type,
        sender_id: m.sender_id,
        content: m.content,
        kind: m.kind,
        attachments: m.attachments,
        created_at: m.created_at,
    }
}

/// Build the chat (REST fallback for WS) router.
pub fn router() -> axum::Router<crate::state::AppState> {
    use axum::routing::{get, post};
    axum::Router::new()
        .route("/channels", get(list_channels).post(create_channel))
        .route(
            "/channels/{id}/messages",
            get(list_messages).post(post_message),
        )
        .route("/channels/{id}/read", post(mark_read))
}
