import 'package:flutter/foundation.dart';

/// A support conversation, mirroring the backend's `ChatChannelOut` DTO.
@immutable
class Channel {
  const Channel({
    required this.id,
    required this.userId,
    required this.status,
    required this.createdAt,
    this.topic,
    this.brandId,
    this.lastMessageAt,
    this.lastMessagePreview,
    this.unreadEmployee = 0,
    this.customer,
    this.assignedTo,
    this.assignedToMe = false,
  });

  final String id;
  final String userId;

  /// `open` | `assigned` | `closed`.
  final String status;
  final String? topic;
  final String? brandId;
  final String? lastMessageAt;
  final String? lastMessagePreview;
  final int unreadEmployee;
  final String createdAt;

  /// The customer who started the channel (joined server-side).
  final ChannelUser? customer;

  /// Staff currently assigned (`null` = waiting in the queue).
  final ChannelUser? assignedTo;
  final bool assignedToMe;

  bool get isOpen => status == 'open';
  bool get isClosed => status == 'closed';

  String get displayName =>
      customer?.fullName?.trim().isNotEmpty == true
          ? customer!.fullName!.trim()
          : customer?.email ?? 'Khách hàng';

  factory Channel.fromJson(Map<String, dynamic> json) => Channel(
        id: json['id'] as String,
        userId: (json['userId'] ?? '') as String,
        status: (json['status'] ?? 'open') as String,
        createdAt: (json['createdAt'] ?? '') as String,
        topic: json['topic'] as String?,
        brandId: json['brandId'] as String?,
        lastMessageAt: json['lastMessageAt'] as String?,
        lastMessagePreview: json['lastMessagePreview'] as String?,
        unreadEmployee: (json['unreadEmployee'] as num?)?.toInt() ?? 0,
        customer: json['user'] == null
            ? null
            : ChannelUser.fromJson(
                Map<String, dynamic>.from(json['user'] as Map),
              ),
        assignedTo: json['assignedTo'] == null
            ? null
            : ChannelUser.fromJson(
                Map<String, dynamic>.from(json['assignedTo'] as Map),
              ),
        assignedToMe: json['assignedToMe'] as bool? ?? false,
      );

  Channel copyWith({
    String? status,
    String? lastMessageAt,
    String? lastMessagePreview,
    int? unreadEmployee,
    ChannelUser? assignedTo,
    bool? assignedToMe,
    bool clearAssignee = false,
  }) =>
      Channel(
        id: id,
        userId: userId,
        status: status ?? this.status,
        createdAt: createdAt,
        topic: topic,
        brandId: brandId,
        lastMessageAt: lastMessageAt ?? this.lastMessageAt,
        lastMessagePreview: lastMessagePreview ?? this.lastMessagePreview,
        unreadEmployee: unreadEmployee ?? this.unreadEmployee,
        customer: customer,
        assignedTo: clearAssignee ? null : (assignedTo ?? this.assignedTo),
        assignedToMe: assignedToMe ?? this.assignedToMe,
      );
}

/// The embedded user profile on a channel (`ChannelUserOut` DTO).
@immutable
class ChannelUser {
  const ChannelUser({
    required this.id,
    this.fullName,
    this.email,
    this.phone,
    this.avatarUrl,
  });

  final String id;
  final String? fullName;
  final String? email;
  final String? phone;
  final String? avatarUrl;

  factory ChannelUser.fromJson(Map<String, dynamic> json) => ChannelUser(
        id: json['id'] as String,
        fullName: json['fullName'] as String?,
        email: json['email'] as String?,
        phone: json['phone'] as String?,
        avatarUrl: json['avatarUrl'] as String?,
      );
}

/// Delivery state of an outgoing message.
enum SendState { sending, sent, failed }

/// A chat message, mirroring `ChatMessageOut` (REST) and the `message`
/// WS broadcast (which uses `text` instead of `content`).
@immutable
class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.channelId,
    required this.senderType,
    required this.kind,
    required this.createdAt,
    this.senderId,
    this.senderName,
    this.content,
    this.clientMsgId,
    this.sendState = SendState.sent,
  });

  final String id;
  final String channelId;

  /// `user` | `employee` | `system` | `assistant` (NullClaw bot).
  final String senderType;
  final String? senderId;
  final String? senderName;
  final String? content;
  final String kind;
  final String createdAt;

  /// Set locally for optimistic sends — reconciled against the REST
  /// response (which echoes `clientMsgId`).
  final String? clientMsgId;
  final SendState sendState;

  bool get isMe => senderType == 'employee' || senderType == 'admin';
  bool get isSystem => senderType == 'system' || senderType == 'assistant';

  factory ChatMessage.fromJson(Map<String, dynamic> json) => ChatMessage(
        id: json['id'] as String,
        channelId: (json['channelId'] ?? '') as String,
        senderType: (json['senderType'] ?? 'user') as String,
        senderId: json['senderId'] as String?,
        senderName: json['senderName'] as String?,
        content: (json['content'] ?? json['text']) as String?,
        kind: (json['kind'] ?? 'text') as String,
        createdAt: (json['createdAt'] ?? '') as String,
        clientMsgId: json['clientMsgId'] as String?,
      );

  ChatMessage copyWith({
    SendState? sendState,
    String? content,
    String? clientMsgId,
  }) =>
      ChatMessage(
        id: id,
        channelId: channelId,
        senderType: senderType,
        senderId: senderId,
        senderName: senderName,
        content: content ?? this.content,
        kind: kind,
        createdAt: createdAt,
        clientMsgId: clientMsgId ?? this.clientMsgId,
        sendState: sendState ?? this.sendState,
      );
}

/// A staff presence row (`StaffPresenceOut` DTO + `staff_presence` WS
/// broadcast).
@immutable
class StaffEntry {
  const StaffEntry({
    required this.userId,
    required this.name,
    required this.role,
    required this.online,
    required this.available,
    required this.busy,
    required this.inCall,
    required this.activeChats,
  });

  final String userId;
  final String name;

  /// `employee` | `admin`.
  final String role;
  final bool online;
  final bool available;
  final bool busy;
  final bool inCall;
  final int activeChats;

  factory StaffEntry.fromJson(Map<String, dynamic> json) => StaffEntry(
        userId: json['userId'] as String,
        name: (json['name'] ?? '') as String,
        role: (json['role'] ?? 'employee') as String,
        online: json['online'] as bool? ?? false,
        available: json['available'] as bool? ?? false,
        busy: json['busy'] as bool? ?? false,
        inCall: json['inCall'] as bool? ?? false,
        activeChats: (json['activeChats'] as num?)?.toInt() ?? 0,
      );
}

@immutable
class StaffSnapshot {
  const StaffSnapshot({
    required this.staff,
    required this.onlineCount,
    required this.availableCount,
    required this.botActive,
  });

  final List<StaffEntry> staff;
  final int onlineCount;
  final int availableCount;

  /// True when NO staff is online — the NullClaw bot owns support.
  final bool botActive;

  factory StaffSnapshot.fromJson(Map<String, dynamic> json) => StaffSnapshot(
        staff: (json['staff'] as List? ?? [])
            .whereType<Map<String, dynamic>>()
            .map((e) => StaffEntry.fromJson(e))
            .toList(),
        onlineCount: (json['onlineCount'] as num?)?.toInt() ?? 0,
        availableCount: (json['availableCount'] as num?)?.toInt() ?? 0,
        botActive: json['botActive'] as bool? ?? false,
      );
}
