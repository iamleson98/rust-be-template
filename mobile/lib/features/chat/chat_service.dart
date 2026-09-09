import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/env.dart';
import '../../core/net/ws_client.dart';

/// Long-lived connection to the chat hub (`/ws`) for the logged-in agent.
///
/// Owns the socket lifecycle and exposes the raw event stream; the
/// conversations/rooms/presence controllers interpret the frames:
///
///  Server → client (frames we consume):
///    `hello`            — post-auth handshake ack
///    `message`          — new message in a JOINED channel room
///    `channel_message`  — customer message, broadcast to ALL staff
///    `channel_created`  — a brand-new support request landed in the queue
///    `channels_changed` / `channel_assigned` / `channel_released` /
///    `channel_closed`   — queue shape changed → refetch
///    `staff_presence`   — team availability snapshot
///    `typing`           — typing indicator in a joined room
///    `presence`         — customer online/offline in a joined room
///    `pong`             — heartbeat ack
///
///  Client → server:
///    `join {channelId}` / `typing {channelId, isTyping}` / `ping`
class ChatLiveService {
  ChatLiveService({
    required Uri Function() wsUrl,
    Future<void> Function()? onHandshakeTrouble,
  }) : _client = WsClient(wsUrl) {
    _onHandshakeTrouble = onHandshakeTrouble;
    _client.connect();
  }

  final WsClient _client;
  Future<void> Function()? _onHandshakeTrouble;
  StreamSubscription<WsStatus>? _statusSub;
  int _consecutiveFailures = 0;
  bool _everConnected = false;

  /// Parsed server frames.
  Stream<Map<String, dynamic>> get events => _client.events;

  Stream<WsStatus> get connectionStates => _client.connectionStates;

  bool get isConnected => _client.isConnected;

  /// Room membership — the hub only broadcasts `message`/`typing`/
  /// `presence` to sockets that joined the channel's room.
  void join(String channelId) => _client.send('join', {'channelId': channelId});

  void sendTyping(String channelId, bool isTyping) =>
      _client.send('typing', {'channelId': channelId, 'isTyping': isTyping});

  /// WS fast-path send (mirrors the customer widget). The agent console
  /// normally sends via REST for guaranteed ack + `clientMsgId` echo.
  bool sendViaWs(String channelId, String text) =>
      _client.send('message', {'channelId': channelId, 'text': text});

  void reconnectNow() => _client.reconnectNow();

  void _watchHandshakes() {
    _statusSub ??= _client.connectionStates.listen((s) {
      if (s == WsStatus.connected) {
        _consecutiveFailures = 0;
        _everConnected = true;
      } else if (s == WsStatus.backoff) {
        // A socket that never opened (handshake rejected) counts as a
        // failure — after a few, ping /auth/me so the interceptor can
        // rotate the access token; the next reconnect picks it up via
        // the URL builder.
        _consecutiveFailures++;
        if (!_everConnected || _consecutiveFailures % 3 == 0) {
          _onHandshakeTrouble?.call();
        }
      }
    });
  }

  void dispose() {
    _statusSub?.cancel();
    _client.dispose();
  }
}

/// Live chat socket for the current session; `null` when logged out.
///
/// Rebuilds (and reconnects) automatically when auth or the server URL
/// changes. The URL builder re-reads the access token on every
/// (re)connect so token rotations are transparent.
final chatLiveServiceProvider = Provider<ChatLiveService?>((ref) {
  final auth = ref.watch(authControllerProvider);
  final user = auth.user;
  final token = auth.accessToken;
  final cfg = ref.watch(appConfigProvider);
  if (user == null || token == null) return null;

  final service = ChatLiveService(
    wsUrl: () {
      // Fresh token at every connect — read from the LIVE token store
      // (kept current by the ApiClient refresh flow), not the
      // login-time auth-state snapshot which goes stale after the
      // first rotation.
      final store = ref.read(globalTokenStore);
      // Proactive rotation when the access JWT is (about to be)
      // expired: rotate NOW so the backoff retry carries a fresh
      // token instead of waiting for repeated handshake failures.
      if (store.accessIsStale) {
        unawaited(ref.read(apiClientProvider).refreshNow());
      }
      final t = store.cachedAccess;
      return cfg.wsUri('/ws', t == null || t.isEmpty ? null : {'token': t});
    },
    onHandshakeTrouble: () async {
      try {
        // Any authed REST call exercises the 401→refresh→retry path.
        await ref.read(apiClientProvider).me();
      } catch (_) {}
    },
  );
  service._watchHandshakes();
  ref.onDispose(service.dispose);
  return service;
});

/// Reactive connection status for the header indicator.
final chatStatusProvider = StreamProvider<WsStatus>((ref) {
  final svc = ref.watch(chatLiveServiceProvider);
  return svc == null ? const Stream.empty() : svc.connectionStates;
});
