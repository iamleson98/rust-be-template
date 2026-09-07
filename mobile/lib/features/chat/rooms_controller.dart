import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/net/api_client.dart';
import 'chat_service.dart';
import 'conversations_controller.dart';
import 'models.dart';

/// Per-channel chat room state.
@immutable
class RoomState {
  const RoomState({
    required this.channel,
    required this.messages,
    this.loading = false,
    this.error,
    this.typingName,
    this.customerOnline = false,
    this.active = true,
  });

  /// Snapshot of the channel (kept loosely in sync with the queue list).
  final Channel channel;

  /// Chronological (oldest → newest).
  final List<ChatMessage> messages;
  final bool loading;
  final String? error;
  final String? typingName;
  final bool customerOnline;

  /// False once closed (trims memory when the agent leaves the room).
  final bool active;

  RoomState copyWith({
    Channel? channel,
    List<ChatMessage>? messages,
    bool? loading,
    String? error,
    String? typingName,
    bool? customerOnline,
    bool? active,
    bool clearError = false,
    bool clearTyping = false,
  }) =>
      RoomState(
        channel: channel ?? this.channel,
        messages: messages ?? this.messages,
        loading: loading ?? this.loading,
        error: clearError ? null : (error ?? this.error),
        typingName: clearTyping ? null : (typingName ?? this.typingName),
        customerOnline: customerOnline ?? this.customerOnline,
        active: active ?? this.active,
      );
}

/// Message history + realtime room events for every open channel.
///
/// One map keyed by channel id — a support session realistically keeps a
/// handful of rooms open, so whole-map copies on each message are cheap
/// and keep the state model trivially debuggable.
class RoomsNotifier extends Notifier<Map<String, RoomState>> {
  StreamSubscription<Map<String, dynamic>>? _sub;
  Timer? _typingStopwatch;
  static const _uuid = Uuid();

  @override
  Map<String, RoomState> build() {
    final svc = ref.watch(chatLiveServiceProvider);
    ref.onDispose(() {
      _sub?.cancel();
      _typingStopwatch?.cancel();
    });
    if (svc == null) return {};
    _sub = svc.events.listen(_onEvent, onError: (_) {});
    return {};
  }

  /// Opens (or re-opens) a room: joins the WS room, fetches history
  /// (backend returns newest-first → reversed), marks it read.
  Future<void> open(String channelId) async {
    final svc = ref.read(chatLiveServiceProvider);
    svc?.join(channelId);

    final existing = state[channelId];
    if (existing != null && existing.messages.isNotEmpty) {
      unawaited(_markRead(channelId));
      return;
    }

    // Resolve the channel snapshot: queue cache first, REST fallback.
    final queue = ref.read(conversationsProvider).value;
    Channel? fromQueue;
    for (final c in queue ?? const <Channel>[]) {
      if (c.id == channelId) {
        fromQueue = c;
        break;
      }
    }
    Channel channel;
    if (fromQueue != null) {
      channel = fromQueue;
    } else {
      try {
        final items = await ref.read(apiClientProvider).listChannels();
        channel = items
            .map(Channel.fromJson)
            .firstWhere((c) => c.id == channelId);
      } catch (_) {
        channel = Channel(
          id: channelId,
          userId: '',
          status: 'open',
          createdAt: '',
        );
      }
    }

    state = {
      ...state,
      channelId: RoomState(
        channel: channel,
        messages: const [],
        loading: true,
      ),
    };

    try {
      final raw = await ref.read(apiClientProvider).listMessages(channelId);
      // Backend lists messages newest-first — reverse for display order.
      final messages =
          raw.map(ChatMessage.fromJson).toList().reversed.toList();
      _updateRoom(channelId, (room) => room.copyWith(
            messages: messages,
            loading: false,
            clearError: true,
          ));
      unawaited(_markRead(channelId));
    } on ApiException catch (e) {
      _updateRoom(channelId, (room) => room.copyWith(
            loading: false,
            error: e.message,
          ));
    } catch (_) {
      _updateRoom(channelId, (room) => room.copyWith(
            loading: false,
            error: 'Không tải được tin nhắn — kéo để thử lại',
          ));
    }
  }

  /// Leaves the room (back to the queue): drop message history but keep
  /// the channel snapshot so re-entry is instant if re-opened soon.
  void close(String channelId) {
    final room = state[channelId];
    if (room == null) return;
    state = {
      ...state,
      channelId: room.copyWith(messages: const [], active: false),
    };
  }

  // ── Sending ────────────────────────────────────────────────────────

  /// Optimistic send: append a `sending` bubble immediately, POST to the
  /// REST endpoint, then reconcile with the authoritative row (matched by
  /// server id, or by `clientMsgId` which the backend echoes back).
  Future<void> send(String channelId, String text) async {
    final content = text.trim();
    if (content.isEmpty) return;
    final clientMsgId = _uuid.v4();
    final now = DateTime.now().toUtc().toIso8601String();

    final optimistic = ChatMessage(
      id: 'local:$clientMsgId',
      channelId: channelId,
      senderType: 'employee',
      senderId: ref.read(authControllerProvider).user?.id,
      senderName: ref.read(authControllerProvider).user?.name,
      content: content,
      kind: 'text',
      createdAt: now,
      clientMsgId: clientMsgId,
      sendState: SendState.sending,
    );
    _updateRoom(channelId, (room) => room.copyWith(
          messages: [...room.messages, optimistic],
          clearTyping: true,
        ));

    try {
      final sent = await ref
          .read(apiClientProvider)
          .sendMessage(channelId, content: content, clientMsgId: clientMsgId);
      final authoritative = ChatMessage.fromJson(sent).copyWith(
        clientMsgId: clientMsgId,
      );
      _reconcile(channelId, clientMsgId, authoritative);
    } on ApiException catch (e) {
      _updateRoom(channelId, (room) => room.copyWith(
            error: e.message,
          ));
      _markLocal(channelId, clientMsgId, SendState.failed);
    } catch (_) {
      _markLocal(channelId, clientMsgId, SendState.failed);
    }
  }

  /// Retry a failed optimistic message with the same clientMsgId.
  Future<void> retry(String channelId, String clientMsgId) async {
    final room = state[channelId];
    if (room == null) return;
    final local = room.messages.firstWhere(
      (m) => m.clientMsgId == clientMsgId,
      orElse: () => throw StateError('missing'),
    );
    _markLocal(channelId, clientMsgId, SendState.sending);
    try {
      final sent = await ref.read(apiClientProvider).sendMessage(
            channelId,
            content: local.content ?? '',
            clientMsgId: clientMsgId,
          );
      _reconcile(
        channelId,
        clientMsgId,
        ChatMessage.fromJson(sent).copyWith(clientMsgId: clientMsgId),
      );
    } catch (_) {
      _markLocal(channelId, clientMsgId, SendState.failed);
    }
  }

  void _reconcile(
    String channelId,
    String clientMsgId,
    ChatMessage authoritative,
  ) {
    _updateRoom(channelId, (room) {
      // If the WS echo already appended the server row (race: echo beat
      // the REST response), just drop the local bubble.
      final alreadyEchoed =
          room.messages.any((m) => m.id == authoritative.id);
      final messages = [
        for (final m in room.messages)
          if (m.clientMsgId == clientMsgId)
            alreadyEchoed ? null : authoritative
          else
            m,
      ].whereType<ChatMessage>().toList();
      return room.copyWith(messages: messages);
    });
  }

  void _markLocal(String channelId, String clientMsgId, SendState s) {
    _updateRoom(channelId, (room) {
      final messages = [
        for (final m in room.messages)
          if (m.clientMsgId == clientMsgId) m.copyWith(sendState: s) else m,
      ];
      return room.copyWith(messages: messages);
    });
  }

  // ── Typing / read receipts ─────────────────────────────────────────

  /// Sends a typing pulse; auto-sends "stopped" after 1.5s of silence.
  void typing(String channelId, bool isTyping) {
    final svc = ref.read(chatLiveServiceProvider);
    svc?.sendTyping(channelId, isTyping);
    if (isTyping) {
      _typingStopwatch?.cancel();
      _typingStopwatch = Timer(const Duration(milliseconds: 1500), () {
        ref.read(chatLiveServiceProvider)?.sendTyping(channelId, false);
      });
    }
  }

  Future<void> _markRead(String channelId) async {
    ref.read(conversationsProvider.notifier).markReadLocally(channelId);
    try {
      await ref.read(apiClientProvider).markRead(channelId);
    } catch (_) {
      // Best-effort — the next open retried anyway.
    }
  }

  // ── WS routing ─────────────────────────────────────────────────────

  void _onEvent(Map<String, dynamic> msg) {
    switch (msg['type'] as String?) {
      case 'message':
        _onRoomMessage(msg);
      case 'typing':
        _onTyping(msg);
      case 'presence':
        _onPresence(msg);
    }
  }

  void _onRoomMessage(Map<String, dynamic> msg) {
    final channelId = msg['channelId'] as String?;
    if (channelId == null || !state.containsKey(channelId)) return;

    final message = ChatMessage.fromJson(msg);
    _updateRoom(channelId, (room) {
      // Dedupe: the REST response may already have appended this id.
      if (room.messages.any((m) => m.id == message.id)) return room;
      return room.copyWith(messages: [...room.messages, message]);
    });

    final fromCustomer = !message.isMe && !message.isSystem;
    if (fromCustomer) {
      // The agent is viewing this room — auto-mark as read.
      unawaited(_markRead(channelId));
    }
  }

  void _onTyping(Map<String, dynamic> msg) {
    final channelId = msg['channelId'] as String?;
    if (channelId == null || !state.containsKey(channelId)) return;
    final isTyping = msg['isTyping'] as bool? ?? false;
    final name = msg['name'] as String?;
    final userId = msg['userId'] as String?;
    // Ignore our own typing echoes (multi-device scenario).
    final myId = ref.read(authControllerProvider).user?.id;
    if (userId != null && userId == myId) return;
    _updateRoom(channelId, (room) => room.copyWith(
          typingName: isTyping ? (name ?? 'Khách hàng') : null,
          clearTyping: !isTyping,
        ));
  }

  void _onPresence(Map<String, dynamic> msg) {
    final channelId = msg['channelId'] as String?;
    if (channelId == null || !state.containsKey(channelId)) return;
    final online = msg['online'] as bool? ?? false;
    _updateRoom(channelId, (room) => room.copyWith(customerOnline: online));
  }

  // ── Mutation helper ────────────────────────────────────────────────

  void _updateRoom(String channelId, RoomState Function(RoomState) fn) {
    final room = state[channelId];
    if (room == null) return;
    state = {...state, channelId: fn(room)};
  }
}

final roomsProvider =
    NotifierProvider<RoomsNotifier, Map<String, RoomState>>(
  RoomsNotifier.new,
);

/// Per-room state for the chat screen (null until opened).
final roomStateProvider = Provider<RoomState?>((ref) {
  final id = ref.watch(activeRoomIdProvider);
  if (id == null) return null;
  return ref.watch(roomsProvider.select((rooms) => rooms[id]));
});

/// The channel the agent is currently inside (drives notifications:
/// no local alert for the room you're actively reading).
class ActiveRoomNotifier extends Notifier<String?> {
  @override
  String? build() => null;

  void set(String? channelId) => state = channelId;
}

final activeRoomIdProvider =
    NotifierProvider<ActiveRoomNotifier, String?>(ActiveRoomNotifier.new);
