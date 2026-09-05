use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use utoipa::IntoParams;
use uuid::Uuid;
use validator::Validate;

use crate::dto::chat::{
    ChannelAssignmentResponse, ChannelUserOut, ChatChannelListResponse, ChatChannelOut,
    ChatMessageListResponse, ChatMessageOut, CreateChannelRequest, CreateChannelResponse,
    CreateMessageRequest, CreateMessageResponse, MarkChannelReadResponse,
};
use crate::entity::{chat_channel, chat_message};
use crate::error::AppError;
use crate::middleware::AuthUser;
use crate::presence::presence;
use crate::service::chat_service::ChatMessageInput;
use crate::state::AppState;

#[derive(Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct ListChannelsQuery {
    pub limit: Option<u64>,
}

/// `GET /api/chat/channels` — list chat channels for the authenticated user.
///
/// For **customers**: returns only their own channels (the ones they started).
/// For **employees**: returns the entire open-channel support queue (optionally
/// filtered by the employee's brand) so support staff see all inbound chats.
///
/// Each channel includes the customer's `user` row (`id`, `fullName`,
/// `email`, `phone`, `avatarUrl`) so the admin's channel list can
/// display "who" without a second round-trip per channel.
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
    // Determine if the caller is an employee → affects which channels they see.
    // Employees see ALL open channels (support queue); customers see only their own.
    let is_employee = st.chats.is_employee(uid).await?;
    // For employees with a brand, narrow the queue to their brand. For
    // brand-less employees (e.g. super-admins), return all open channels.
    let brand_id = if is_employee {
        // Look up the user to get their brand_id. Best-effort — if the
        // lookup fails, fall back to None (all open channels).
        match st.users.get(uid).await {
            Ok(u) => u.brand_id,
            Err(_) => None,
        }
    } else {
        None
    };

    let channels = st
        .chats
        .list_channels(uid, is_employee, brand_id, q.limit.unwrap_or(50))
        .await?;

    // Batch-fetch the customer user rows for every channel in one
    // round-trip (avoids N+1 queries when listing channels for the
    // admin support queue). Each `user::Model` is then mapped to
    // `ChannelUserOut` (fullName / email / phone / avatarUrl) and
    // embedded in the channel DTO.
    let user_ids: Vec<Uuid> = channels.iter().map(|c| c.user_id).collect();
    let user_map = st.users.find_by_ids(&user_ids).await?;
    let user_dtos: std::collections::HashMap<Uuid, ChannelUserOut> = user_map
        .iter()
        .map(|(id, u)| {
            (
                *id,
                ChannelUserOut {
                    id: u.id,
                    full_name: Some(u.full_name.clone()),
                    email: Some(u.email.clone()),
                    phone: u.phone.clone(),
                    avatar_url: u.avatar_url.clone(),
                },
            )
        })
        .collect();

    // Batch-fetch the ACTIVE assignment rows for all listed channels +
    // the assignee user rows (one round-trip each — same pattern as the
    // customer batch-fetch above).
    let channel_uuids: Vec<Uuid> = channels.iter().map(|c| c.id).collect();
    let assignments = st.chats.channel_assignments(&channel_uuids).await?;
    let assignee_ids: Vec<Uuid> = assignments
        .iter()
        .filter_map(|a| {
            a.employee_id
                .as_deref()
                .and_then(|id| Uuid::parse_str(id).ok())
        })
        .collect();
    let assignee_map = if assignee_ids.is_empty() {
        std::collections::HashMap::new()
    } else {
        st.users.find_by_ids(&assignee_ids).await?
    };
    let assignee_dtos: std::collections::HashMap<Uuid, ChannelUserOut> = assignee_map
        .iter()
        .map(|(id, u)| {
            (
                *id,
                ChannelUserOut {
                    id: u.id,
                    full_name: Some(u.full_name.clone()),
                    email: Some(u.email.clone()),
                    phone: u.phone.clone(),
                    avatar_url: u.avatar_url.clone(),
                },
            )
        })
        .collect();
    let assignment_by_channel: std::collections::HashMap<
        Uuid,
        &crate::entity::chat_assignment::Model,
    > = assignments.iter().map(|a| (a.channel_id, a)).collect();

    let items: Vec<ChatChannelOut> = channels
        .into_iter()
        .map(|c| {
            let user_info = user_dtos.get(&c.user_id).cloned();
            let assigned_to = assignment_by_channel
                .get(&c.id)
                .and_then(|a| a.employee_id.as_deref())
                .and_then(|id| Uuid::parse_str(id).ok())
                .and_then(|uuid| assignee_dtos.get(&uuid).cloned());
            let assigned_to_me = assignment_by_channel
                .get(&c.id)
                .and_then(|a| a.employee_id.as_deref())
                .is_some_and(|id| Uuid::parse_str(id).is_ok_and(|u| u == uid));
            channel_to_dto(c, user_info, assigned_to, assigned_to_me)
        })
        .collect();
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
///
/// Returns messages in **DESC order (newest first)** to support
/// cursor pagination. The frontend reverses the page before rendering
/// so the oldest message is at the top + the newest at the bottom
/// (the natural chat reading order).
///
/// - `limit` defaults to 30 (modern chat default — fast first paint).
///   Max 200.
/// - `offset` defaults to 0. `offset=30` returns the next 30 OLDER
///   messages.
///
/// When a new message arrives via WS, the frontend invalidates this
/// query so the latest page refetches with the new message at the
/// top of the DESC page (which becomes the bottom after the
/// frontend reverses it).
#[utoipa::path(
    get,
    path = "/api/chat/channels/{id}/messages",
    tag = "chat",
    params(
        ("id" = Uuid, Path, description = "Channel ID"),
        ListMessagesQuery,
    ),
    responses(
        (status = 200, description = "Message list (newest first)", body = ChatMessageListResponse),
        (status = 401, description = "Unauthorized"),
    )
)]
pub async fn list_messages(
    State(st): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Query(q): Query<ListMessagesQuery>,
) -> Result<Json<ChatMessageListResponse>, AppError> {
    // BOLA defense: verify the caller owns the channel or is an employee.
    // Returns 404 (not 403) when unauthorized so we don't leak the
    // existence of channels the caller has no business reading.
    st.chats.assert_channel_access(uid, &id.to_string()).await?;
    let msgs = st
        .chats
        .list_messages(
            &id.to_string(),
            q.limit.unwrap_or(30).min(200),
            q.offset.unwrap_or(0),
        )
        .await?;
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
    // BOLA defense: verify the caller owns the channel or is an employee.
    st.chats.assert_channel_access(uid, &id.to_string()).await?;
    // The side depends on whether the caller is an employee (admin/support)
    // or the customer. Determine via RBAC role check.
    let is_employee = st.chats.is_employee(uid).await?;
    let side = if is_employee { "employee" } else { "user" };
    st.chats.clear_unread(&id.to_string(), side).await?;
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
        .chats
        .create_channel(uid, body.brand_id, body.topic)
        .await?;

    // Broadcast a `channel_created` event to ALL connected WS sockets.
    // This lets the admin's chat workspace auto-refetch the channels
    // list when a new user starts a chat — without the admin needing
    // to manually reload the page.
    crate::ws::hub::hub().broadcast_all(
        &serde_json::json!({
            "type": "channel_created",
            "channelId": channel.id.to_string(),
            "userId": uid.to_string(),
        })
        .to_string(),
    );

    // Populate the customer's user row so the response includes
    // `user.fullName` / `user.email` / `user.phone` for the admin's
    // channel list.
    let user_info = st
        .users
        .find_by_ids(&[channel.user_id])
        .await?
        .get(&channel.user_id)
        .map(|u| ChannelUserOut {
            id: u.id,
            full_name: Some(u.full_name.clone()),
            email: Some(u.email.clone()),
            phone: u.phone.clone(),
            avatar_url: u.avatar_url.clone(),
        });

    Ok(Json(CreateChannelResponse {
        channel: channel_to_dto(channel, user_info, None, false),
    }))
}

/// `POST /api/chat/channels/{id}/messages` — REST fallback for posting
/// a chat message.
///
/// Auth required: the caller must be the channel's owner (user side)
/// or an employee. Idempotent via `client_msg_id`.
///
/// **WS broadcast**: after the message is persisted, we broadcast a
/// `message` event to the channel room so the OTHER side (customer or
/// admin) sees the reply in realtime without needing to refetch. We
/// ALSO broadcast a `channel_message` event to ALL online employees
/// (admin attention signal) when the sender is a customer.
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

    // BOLA defense: verify the caller owns the channel or is an employee.
    // (Replaces the previous `channel_exists` check which only verified
    // existence, not ownership — letting any auth'd user post into any
    // other user's support chat.)
    st.chats.assert_channel_access(uid, &channel_id).await?;

    // Idempotency: if the client already sent this client_msg_id, return
    // the stored message. Single SQL round-trip via `find_message_by_client_id`
    // (replaces the previous O(100) linear scan over recent messages).
    if let Some(client_msg_id) = body.client_msg_id.as_deref() {
        if !client_msg_id.is_empty() {
            if let Some(stored) = st
                .chats
                .find_message_by_client_id(&channel_id, client_msg_id)
                .await?
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
    let is_employee = st.chats.is_employee(uid).await?;
    let sender_type = if is_employee { "employee" } else { "user" };

    // Load the sender's name + email for the WS broadcast payload.
    // Best-effort — if the lookup fails, fall back to empty strings.
    let sender_user = st.users.get(uid).await.ok();

    let msg = st
        .chats
        .insert_message(ChatMessageInput {
            channel_id: id,
            sender_type: sender_type.to_string(),
            sender_id: Some(uid),
            content: body.content.clone(),
            kind: body.kind,
            attachments: body.attachments,
            client_msg_id: body.client_msg_id.filter(|s| !s.is_empty()),
        })
        .await?;

    // ── Increment the unread counter for the OTHER side ───────────
    //
    // Customer sends → admin's `unread_employee` grows.
    // Employee sends → customer's `unread_user` grows.
    // Best-effort — a failure here is logged + swallowed because the
    // message itself was already persisted; the unread counter is
    // secondary UX metadata. The WS handler does the same.
    let unread_side = if sender_type == "user" {
        "employee"
    } else {
        "user"
    };
    if let Err(e) = st.chats.increment_unread(&channel_id, unread_side).await {
        tracing::warn!(
            channel_id = %channel_id,
            side = unread_side,
            error = %e,
            "failed to increment unread counter (continuing)"
        );
    }

    // ── WS broadcast: deliver to the channel room ──────────────────
    //
    // The WS handler does this for WS-originated messages. The REST
    // path needs to do it manually so the other side sees the reply
    // in realtime (otherwise the customer has to refetch messages
    // manually — that's the "admin reply not showing in user's chat"
    // bug).
    let sender_name = sender_user
        .as_ref()
        .map(|u| u.full_name.clone())
        .unwrap_or_default();
    let now = msg.created_at.clone();
    let text = body.content.clone().unwrap_or_default();
    let preview: String = text.chars().take(80).collect();
    let message_id_str = msg.id.to_string();

    let room_broadcast = serde_json::json!({
        "type": "message",
        "id": message_id_str,
        "channelId": channel_id,
        "senderType": sender_type,
        "senderId": uid,
        "senderName": sender_name,
        "text": text,
        "createdAt": now,
    });
    crate::ws::hub::hub().broadcast_to_room(&channel_id, &room_broadcast);

    // ── Assignment routing + targeted notifications ─────────────────
    //
    // Mirrors the WS path: when a CUSTOMER sends via REST (rare — the
    // WS is the primary transport), run the router so unassigned
    // channels get an owner. Employee replies skip fan-out (the room
    // broadcast above already reached the customer + watchers).
    if sender_type == "user" {
        let outcome = st.chats.route_user_message(&channel_id).await?;
        let notify = serde_json::json!({
            "type": "channel_message",
            "channelId": channel_id,
            "senderId": uid,
            "senderName": sender_name,
            "preview": preview,
            "createdAt": now,
            "messageId": message_id_str,
        });
        let hub = crate::ws::hub::hub();
        match &outcome {
            crate::service::chat_service::RoutingOutcome::ToAssignee { employee_id } => {
                hub.send_to_user(employee_id, &notify);
                hub.broadcast_to_admins(&notify);
            }
            crate::service::chat_service::RoutingOutcome::NewlyAssigned { employee_id } => {
                hub.send_to_user(employee_id, &notify);
                hub.broadcast_to_admins(&notify);
                let name = presence()
                    .get(employee_id)
                    .map(|p| p.name)
                    .unwrap_or_else(|| "Nhân viên hỗ trợ".into());
                hub.broadcast_to_room(
                    &channel_id,
                    &serde_json::json!({
                        "type": "channel_assigned",
                        "channelId": channel_id,
                        "employeeId": employee_id,
                        "employeeName": name,
                        "role": "employee",
                        "status": "assigned",
                    }),
                );
                hub.broadcast_to_staff(&serde_json::json!({ "type": "channels_changed" }));
            }
            crate::service::chat_service::RoutingOutcome::AdminImplicit { admin_id } => {
                hub.broadcast_to_admins(&notify);
                let name = presence()
                    .get(admin_id)
                    .map(|p| p.name)
                    .unwrap_or_else(|| "Quản trị viên".into());
                hub.broadcast_to_room(
                    &channel_id,
                    &serde_json::json!({
                        "type": "channel_assigned",
                        "channelId": channel_id,
                        "employeeId": admin_id,
                        "employeeName": name,
                        "role": "admin",
                        "status": "open",
                    }),
                );
            }
            crate::service::chat_service::RoutingOutcome::BotFallback
            | crate::service::chat_service::RoutingOutcome::QueuedForAdmin => {
                hub.broadcast_to_staff(&notify);
            }
        }
    }

    Ok(Json(CreateMessageResponse {
        message: message_to_dto(msg),
    }))
}

// ────────────────────────────────────────────────────────────────
//  Channel assignment actions (staff-only)
// ────────────────────────────────────────────────────────────────

/// Load the requesters' `SessionUser` (needed by the service layer's
/// claim/release authorization). 404s when the auth'd user vanished.
async fn session_user_of(st: &AppState, uid: Uuid) -> Result<crate::auth::SessionUser, AppError> {
    st.auth
        .session_user_by_id(uid)
        .await
        .map_err(|e| AppError::Unauthorized(format!("user no longer exists: {e}")))
}

/// Broadcast a channel-state change so every open dashboard refetches:
/// the room learns the new assignment, staff learn the queue changed.
fn broadcast_channel_update(
    channel: &chat_channel::Model,
    assignment_event: Option<serde_json::Value>,
) {
    let hub = crate::ws::hub::hub();
    let channel_id = channel.id.to_string();
    if let Some(ev) = assignment_event {
        hub.broadcast_to_room(&channel_id, &ev);
    }
    hub.broadcast_to_staff(&serde_json::json!({
        "type": "channels_changed",
        "channelId": channel_id,
        "status": channel.status,
    }));
    // Presence load changed for the assignee — refresh staff panels.
    hub.broadcast_staff_presence(channel.brand_id.map(|b| b.to_string()).as_deref());
}

/// `POST /api/chat/channels/{id}/claim` — a staff member takes over the
/// channel. Employees get a `chat_assignment` row; admins implicitly
/// own every channel (no row, per the three-role spec).
#[utoipa::path(
    post,
    path = "/api/chat/channels/{id}/claim",
    tag = "chat",
    params(("id" = Uuid, Path, description = "Channel ID")),
    responses(
        (status = 200, description = "Channel claimed", body = ChannelAssignmentResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden — customers cannot claim"),
        (status = 404, description = "Channel not found"),
    )
)]
pub async fn claim_channel(
    State(st): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ChannelAssignmentResponse>, AppError> {
    let staff = session_user_of(&st, uid).await?;
    if !staff.is_staff() {
        return Err(AppError::Forbidden("only staff may claim channels".into()));
    }
    let channel_id = id.to_string();
    st.chats.assert_channel_access(uid, &channel_id).await?;
    let assignee_id = st.chats.claim_channel(&channel_id, &staff).await?;
    let channel = st
        .chats
        .get_channel(&channel_id)
        .await?
        .ok_or_else(|| AppError::NotFound("chat channel not found".into()))?;
    let assignee_name = presence()
        .get(&assignee_id)
        .map(|p| p.name)
        .unwrap_or_else(|| staff.name.clone());
    broadcast_channel_update(
        &channel,
        Some(serde_json::json!({
            "type": "channel_assigned",
            "channelId": channel_id,
            "employeeId": assignee_id,
            "employeeName": assignee_name,
            "role": if staff.is_admin() { "admin" } else { "employee" },
            "status": channel.status,
        })),
    );
    let user_info = st
        .users
        .get(channel.user_id)
        .await
        .ok()
        .map(|u| ChannelUserOut {
            id: u.id,
            full_name: Some(u.full_name.clone()),
            email: Some(u.email.clone()),
            phone: u.phone.clone(),
            avatar_url: u.avatar_url.clone(),
        });
    let assigned_to_me = Uuid::parse_str(&assignee_id).is_ok_and(|a| a == uid);
    Ok(Json(ChannelAssignmentResponse {
        ok: true,
        channel: channel_to_dto(channel, user_info, None, assigned_to_me),
    }))
}

/// `POST /api/chat/channels/{id}/release` — return the channel to the
/// open support queue. Allowed for the current assignee or any admin.
#[utoipa::path(
    post,
    path = "/api/chat/channels/{id}/release",
    tag = "chat",
    params(("id" = Uuid, Path, description = "Channel ID")),
    responses(
        (status = 200, description = "Channel released", body = ChannelAssignmentResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden — not the assignee or an admin"),
        (status = 404, description = "Channel not found"),
    )
)]
pub async fn release_channel(
    State(st): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ChannelAssignmentResponse>, AppError> {
    let requester = session_user_of(&st, uid).await?;
    let channel_id = id.to_string();
    st.chats.assert_channel_access(uid, &channel_id).await?;
    st.chats.release_channel(&channel_id, &requester).await?;
    let channel = st
        .chats
        .get_channel(&channel_id)
        .await?
        .ok_or_else(|| AppError::NotFound("chat channel not found".into()))?;
    broadcast_channel_update(
        &channel,
        Some(serde_json::json!({
            "type": "channel_released",
            "channelId": channel_id,
            "status": channel.status,
        })),
    );
    let user_info = st
        .users
        .get(channel.user_id)
        .await
        .ok()
        .map(|u| ChannelUserOut {
            id: u.id,
            full_name: Some(u.full_name.clone()),
            email: Some(u.email.clone()),
            phone: u.phone.clone(),
            avatar_url: u.avatar_url.clone(),
        });
    Ok(Json(ChannelAssignmentResponse {
        ok: true,
        channel: channel_to_dto(channel, user_info, None, false),
    }))
}

/// `POST /api/chat/channels/{id}/close` — close the channel (ends any
/// assignment). Any staff member may close.
#[utoipa::path(
    post,
    path = "/api/chat/channels/{id}/close",
    tag = "chat",
    params(("id" = Uuid, Path, description = "Channel ID")),
    responses(
        (status = 200, description = "Channel closed", body = ChannelAssignmentResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden — staff only"),
        (status = 404, description = "Channel not found"),
    )
)]
pub async fn close_channel(
    State(st): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ChannelAssignmentResponse>, AppError> {
    let requester = session_user_of(&st, uid).await?;
    if !requester.is_staff() {
        return Err(AppError::Forbidden("only staff may close channels".into()));
    }
    let channel_id = id.to_string();
    st.chats.assert_channel_access(uid, &channel_id).await?;
    st.chats.close_channel_as_staff(&channel_id).await?;
    let channel = st
        .chats
        .get_channel(&channel_id)
        .await?
        .ok_or_else(|| AppError::NotFound("chat channel not found".into()))?;
    broadcast_channel_update(
        &channel,
        Some(serde_json::json!({
            "type": "channel_closed",
            "channelId": channel_id,
            "status": "closed",
        })),
    );
    let user_info = st
        .users
        .get(channel.user_id)
        .await
        .ok()
        .map(|u| ChannelUserOut {
            id: u.id,
            full_name: Some(u.full_name.clone()),
            email: Some(u.email.clone()),
            phone: u.phone.clone(),
            avatar_url: u.avatar_url.clone(),
        });
    Ok(Json(ChannelAssignmentResponse {
        ok: true,
        channel: channel_to_dto(channel, user_info, None, false),
    }))
}

// ────────────────────────────────────────────────────────────────
//  Mappers + helpers
// ────────────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
fn channel_to_dto(
    c: chat_channel::Model,
    user_info: Option<ChannelUserOut>,
    assigned_to: Option<ChannelUserOut>,
    assigned_to_me: bool,
) -> ChatChannelOut {
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
        user: user_info,
        assigned_to,
        assigned_to_me,
    }
}

fn message_to_dto(m: chat_message::Model) -> ChatMessageOut {
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
        .route("/channels/{id}/claim", post(claim_channel))
        .route("/channels/{id}/release", post(release_channel))
        .route("/channels/{id}/close", post(close_channel))
        .route(
            "/channels/{id}/messages",
            get(list_messages).post(post_message),
        )
        .route("/channels/{id}/read", post(mark_read))
}
