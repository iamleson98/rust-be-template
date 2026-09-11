import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/env.dart';
import '../../core/net/ws_client.dart';
import 'call_state.dart' show parseIceServers;

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
///   ← `registered {role, userId, onlineAgents, iceServers, activeCall}`
///   → `call {to, kind: offer|answer|ice, sdp?, candidate?, channelId?}`
///   ← `incoming {from, channelId, sdp, kind}`
///   ← `answer {from, sdp}` / `ice {from, candidate}` / `hangup {from, reason}`
///   → `hangup {to, reason}` (reason ∈ busy|declined|timeout|remote)
///   ← `presence {onlineAgents}` / `error {code, message}` / `pong`
///
/// Renegotiation (ICE restart — network resilience):
///   → `call {to, kind: offer, iceRestart: true, sdp}` — offerer re-offers
///     with fresh candidates after the media path failed
///   ← `renegotiate {from, sdp, kind: offer}` — apply to the EXISTING peer
///     connection, answer, then:
///   → `call {to, kind: answer, iceRestart: true, sdp}`
///   ← `renegotiate {from, sdp, kind: answer}` — setRemoteDescription.
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
    _signals = _client.events.map((msg) {
      if (msg['type'] == 'registered') {
        final servers = parseIceServers(msg['iceServers']);
        if (servers.isNotEmpty) iceServers = servers;
        if (msg['onlineAgents'] is int) onlineAgents = msg['onlineAgents'] as int;
      }
      return msg;
    }).asBroadcastStream();
    _statusSub = _client.connectionStates.listen(_onStatus);
    _client.connect();
  }

  final WsClient _client;
  final String Function() _userId;
  StreamSubscription<WsStatus>? _statusSub;

  /// Raw signal frames (see class docs).
  late final Stream<Map<String, dynamic>> _signals;
  Stream<Map<String, dynamic>> get signals => _signals;

  /// Connection lifecycle of the underlying socket (connected /
  /// disconnected / backoff). The call controller watches it: a socket
  /// that drops mid-call means the server ended the session it carried,
  /// so a still-"active" call UI must not zombie on.
  Stream<WsStatus> get connectionStates => _client.connectionStates;

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
      // Candidates buffered while the socket was down ride along with
      // the register: the server relays them to the live session's peer
      // (addIceCandidate on the peer tolerates duplicates). Without this,
      // every WS blip during ICE negotiation silently dropped our half
      // of the candidate set — the peer can never connect and the call
      // UI sits on "connecting" until the timeout fires (the exact
      // office-network failure mode).
      _flushPendingIce();
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

  /// Trickle ICE to the peer we're negotiating with. When the socket is
  /// down and a call is live, the candidate is BUFFERED (bounded) instead
  /// of dropped — flushed by `_onStatus` on the next reconnect.
  bool sendIce(String to, Map<String, dynamic>? candidate) {
    final msg = <String, dynamic>{
      'to': to,
      'from': _userId(),
      'kind': 'ice',
      'candidate': candidate,
    };
    if (_client.isConnected) {
      return _client.send('call', msg);
    }
    if (hasLiveCall() && _pendingIce.length < _maxPendingIce) {
      _pendingIce.add(msg);
    }
    return false;
  }

  bool hangup(String to, [String reason = 'remote']) => _client.send(
        'hangup',
        {'to': to, 'from': _userId(), 'reason': reason},
      );

  // ── Renegotiation (ICE restart) ──────────────────────────────────

  /// OFFERER only: re-offer with fresh candidates after the media path
  /// failed. Relayed by the server as `renegotiate` (kind: offer).
  bool sendRenegotiateOffer(String to, Map<String, dynamic> sdp) =>
      _client.send('call', {
        'to': to,
        'from': _userId(),
        'kind': 'offer',
        'iceRestart': true,
        'sdp': sdp,
      });

  /// ANSWERER only: reply to a `renegotiate` offer on the EXISTING peer
  /// connection (never a new call / new ring).
  bool sendRenegotiateAnswer(String to, Map<String, dynamic> sdp) =>
      _client.send('call', {
        'to': to,
        'from': _userId(),
        'kind': 'answer',
        'iceRestart': true,
        'sdp': sdp,
      });

  // ── Pending-ICE buffer ─────────────────────────────────────────

  static const _maxPendingIce = 64;
  final List<Map<String, dynamic>> _pendingIce = [];

  /// Set by the call controller: candidates are only worth buffering
  /// while a call is live (otherwise they are stale noise).
  bool Function() hasLiveCall = () => false;

  void _flushPendingIce() {
    if (_pendingIce.isEmpty) return;
    final queued = List<Map<String, dynamic>>.from(_pendingIce);
    _pendingIce.clear();
    for (final msg in queued) {
      _client.send('call', msg);
    }
  }

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
      // Read from the LIVE token store, not the auth-state snapshot:
      // the ApiClient rotates the access token on 401 (refresh flow)
      // but AuthState.accessToken keeps the login-time token. A stale
      // token here would make every reconnect fail auth forever —
      // the phone would silently stop receiving calls.
      // (`globalTokenStore` is a plain process-global — no ref.read.)
      final store = globalTokenStore;
      // Proactive rotation: in duty mode there is no REST traffic to
      // trigger the 401 interceptor, so an expired access token would
      // fail every WS handshake until something else refreshes it.
      // Kick a single-flight refresh NOW; this attempt may still 401
      // but the backoff retry (1s..30s) picks up the fresh JWT.
      if (store.accessIsStale) {
        unawaited(ref.read(apiClientProvider).refreshNow());
      }
      final t = store.cachedAccess;
      return cfg.wsUri('/ws-call', t == null || t.isEmpty ? null : {'token': t});
    },
    userId: () => ref.read(authControllerProvider).user?.id ?? '',
  );

  ref.onDispose(service.dispose);
  return service;
});
