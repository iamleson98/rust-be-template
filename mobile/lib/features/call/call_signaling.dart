import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/env.dart';
import '../../core/net/ws_client.dart';

/// WebRTC signaling relay client for `/ws-call`.
///
/// The server is a pure relay: SDP offers/answers and ICE candidates are
/// routed between the two peers; audio flows peer-to-peer. This client
/// registers as an **agent** (staff only, enforced by RBAC server-side)
/// and keeps the socket open for the whole session so incoming calls
/// ring at any time.
///
/// Protocol (JSON frames):
///   → `register {role, userId, channelId?}`
///   ← `registered {role, userId, onlineAgents, iceServers}`
///   → `call {to, kind: offer|answer|ice, sdp?, candidate?, channelId?}`
///   ← `incoming {from, channelId, sdp, kind}`
///   ← `answer {from, sdp}` / `ice {from, candidate}` / `hangup {from, reason}`
///   → `hangup {to, reason}` (reason ∈ busy|declined|timeout|remote)
///   ← `presence {onlineAgents}` / `error {code, message}` / `pong`
class CallSignalingService {
  CallSignalingService({
    required Uri Function() wsUrl,
    required this._userId,
  }) :
        _client = WsClient(
          wsUrl,
          // `/ws-call` understands app-level `heartbeat` frames (replies
          // `pong`); the chat `/ws` socket relies on protocol pings only.
          heartbeatType: 'heartbeat',
        ) {
    _signals = _client.events;
    _statusSub = _client.connectionStates.listen(_onStatus);
    _client.connect();
  }

  final WsClient _client;
  final String Function() _userId;
  StreamSubscription<WsStatus>? _statusSub;

  /// Raw signal frames (see class docs).
  late final Stream<Map<String, dynamic>> _signals;
  Stream<Map<String, dynamic>> get signals => _signals;

  /// STUN/TURN servers pushed by the server in `registered` (empty →
  /// callers fall back to public STUN).
  List<Map<String, dynamic>> iceServers = const [];

  /// Online agent count (presence broadcasts).
  int onlineAgents = 0;

  /// Optional context channel — re-sent with each registration.
  String? contextChannel;

  void _onStatus(WsStatus status) {
    if (status == WsStatus.connected) {
      // (Re)register on every (re)connect — the hub is stateless across
      // sockets; re-registering also refreshes our agent presence.
      _client.send('register', {
        'role': 'agent',
        'userId': _userId(),
        'channelId': contextChannel,
      });
    }
  }

  // ── Outbound signals ───────────────────────────────────────────────

  /// Agent → customer offer. `to` is the customer's user id.
  bool sendOffer(String to, Map<String, dynamic> sdp, {String? channelId}) =>
      _client.send('call', {
        'to': to,
        'from': _userId(),
        'kind': 'offer',
        'sdp': sdp,
        if (channelId != null) 'channelId': channelId,
      });

  /// Answer for an accepted offer.
  bool sendAnswer(String to, Map<String, dynamic> sdp) => _client.send(
        'call',
        {'to': to, 'from': _userId(), 'kind': 'answer', 'sdp': sdp},
      );

  /// Trickle ICE to the peer we're negotiating with.
  bool sendIce(String to, Map<String, dynamic>? candidate) =>
      _client.send('call', {
        'to': to,
        'from': _userId(),
        'kind': 'ice',
        'candidate': candidate,
      });

  bool hangup(String to, [String reason = 'remote']) => _client.send(
        'hangup',
        {'to': to, 'from': _userId(), 'reason': reason},
      );

  /// Immediate reconnect (app resumed from background).
  void reconnectNow() => _client.reconnectNow();

  void dispose() {
    _statusSub?.cancel();
    _client.dispose();
  }
}

/// The call signaling socket for the current session; `null` when the
/// agent is logged out. The URL builder re-reads the (possibly rotated)
/// access token on every reconnect.
final callSignalingProvider = Provider<CallSignalingService?>((ref) {
  final auth = ref.watch(authControllerProvider);
  final user = auth.user;
  final token = auth.accessToken;
  final cfg = ref.watch(appConfigProvider);
  if (user == null || token == null) return null;

  final service = CallSignalingService(
    wsUrl: () {
      final t = ref.read(authControllerProvider).accessToken;
      return cfg.wsUri('/ws-call', t == null ? null : {'token': t});
    },
    userId: () => ref.read(authControllerProvider).user?.id ?? '',
  );

  ref.onDispose(service.dispose);
  return service;
});
