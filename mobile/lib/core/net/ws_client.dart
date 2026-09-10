import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

/// Lifecycle states surfaced through [connectionStates].
enum WsStatus { disconnected, connecting, connected, backoff }

/// JSON-envelope WebSocket with resilient reconnection.
///
/// Mirrors the web client's `ws-client.ts` contract: a tiny
/// `{"type": "<event>", ...}` envelope over a single socket, exponential
/// backoff with **full jitter** (thundering-herd protection when the
/// backend restarts), capped at 30s. Unlike the browser client, an
/// always-on support console retries indefinitely — the agent should not
/// have to pull-to-refresh after a server blip.
///
/// ## Half-open socket detection (pong watchdog)
///
/// Office / corporate networks rotate the public IP (NAT rebinding),
/// which kills long-lived TCP WITHOUT a FIN/RST — the socket LOOKS open
/// but every byte vanishes into a dead NAT mapping. Protocol-level pings
/// catch this eventually, but the app-level heartbeat (`/ws-call`
/// answers `heartbeat` with `pong`) lets us detect it deterministically:
/// if no frame of ANY kind arrives for `2.5x` the heartbeat interval
/// while we're heartbeating, the socket is declared dead and reconnected
/// immediately — presence + call reconciliation then converge to the
/// server's truth instead of the UI freezing on a ghost connection.
class WsClient {
  WsClient(
    Uri Function() uriBuilder, {
    Duration? pingInterval,
    String? heartbeatType,
  })  : _uriBuilder = uriBuilder,
        _appHeartbeatType = heartbeatType,
        _pingInterval = pingInterval ?? const Duration(seconds: 20);

  /// Re-evaluated on every (re)connect so a rotated access token is
  /// picked up without rebuilding the service.
  final Uri Function() _uriBuilder;
  final Duration _pingInterval;

  /// App-level heartbeat frame type, or null to rely purely on
  /// protocol-level WS pings. The `/ws` chat hub has NO app-level
  /// heartbeat handler (unknown types get an error frame back), so only
  /// `/ws-call` opts in — it answers `heartbeat` with `pong`.
  final String? _appHeartbeatType;

  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _sub;
  Timer? _reconnectTimer;
  Timer? _heartbeater;
  int _attempts = 0;
  bool _disposed = false;

  /// Last time ANY frame arrived (data, pong, anything). Drives the
  /// half-open watchdog — see the class docs.
  DateTime _lastFrameAt = DateTime.now();

  static const _maxBackoffMs = 30_000;
  static const _baseBackoffMs = 1_000;

  /// Server close codes that mean "slow down" — retry in the upper part
  /// of the backoff window (1008 policy / 1011 server error / 1013 retry).
  static const _slowDownCodes = {1008, 1011, 1013};

  final _events = StreamController<Map<String, dynamic>>.broadcast();
  final _status = StreamController<WsStatus>.broadcast();

  /// Parsed server frames (`type` + payload fields).
  Stream<Map<String, dynamic>> get events => _events.stream;

  /// Connection lifecycle for status indicators.
  Stream<WsStatus> get connectionStates => _status.stream;

  WsStatus _statusValue = WsStatus.disconnected;
  WsStatus get status => _statusValue;
  bool get isConnected => _statusValue == WsStatus.connected;

  void connect() {
    if (_disposed) return;
    if (_statusValue == WsStatus.connected ||
        _statusValue == WsStatus.connecting) {
      return;
    }
    _setStatus(WsStatus.connecting);
    try {
      final channel = IOWebSocketChannel.connect(
        _uriBuilder(),
        pingInterval: _pingInterval,
      );
      _channel = channel;
      // `ready` resolves once the handshake completes — the socket can then
      // SEND (the /ws-call flow must send `register` before the server
      // ever replies). Handshake failure schedules a reconnect.
      channel.ready.then(
        (_) {
          if (_disposed) return;
          _attempts = 0;
          _setStatus(WsStatus.connected);
          _startHeartbeater();
        },
        onError: (_) => _onDone(),
      );
      _sub = channel.stream.listen(
        _onFrame,
        onDone: _onDone,
        onError: (_) => _onDone(),
        cancelOnError: true,
      );
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _onFrame(dynamic raw) {
    if (_disposed || raw is! String) return;
    _lastFrameAt = DateTime.now();
    Map<String, dynamic> msg;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) return;
      msg = decoded;
    } catch (_) {
      return; // tolerate non-JSON frames
    }
    if (_statusValue != WsStatus.connected) {
      // First frame implies the socket is live even if we missed onDone
      // ordering; upgrade the status and reset backoff.
      _attempts = 0;
      _setStatus(WsStatus.connected);
    }
    _events.add(msg);
  }

  void _onDone() {
    _stopHeartbeater();
    if (_disposed) return;
    _setStatus(WsStatus.disconnected);
    _teardownChannel();
    _scheduleReconnect();
  }

  void _teardownChannel() {
    _sub?.cancel();
    _sub = null;
    try {
      _channel?.sink.close();
    } catch (_) {}
    _channel = null;
  }

  void _scheduleReconnect({int? closeCode}) {
    if (_disposed) return;
    if (_reconnectTimer?.isActive ?? false) return;
    _attempts++;
    final expo = min(
      _baseBackoffMs * (1 << min(_attempts, 5)),
      _maxBackoffMs,
    );
    final slowDown = closeCode != null && _slowDownCodes.contains(closeCode);
    // Full jitter [0, expo); slow-down codes use the upper 40%.
    var delay = Random().nextDouble() * expo;
    if (slowDown) delay = expo * 0.6 + delay * 0.4;
    _setStatus(WsStatus.backoff);
    _reconnectTimer = Timer(Duration(milliseconds: delay.toInt()), connect);
  }

  void _startHeartbeater() {
    _stopHeartbeater();
    final type = _appHeartbeatType;
    if (type == null) return;
    _lastFrameAt = DateTime.now();
    _heartbeater = Timer.periodic(_pingInterval, (_) {
      // App-level heartbeat (server answers with `pong`); complements the
      // protocol-level pings by keeping NAT mappings warm on mobile radios.
      send(type, {'__client_ts': DateTime.now().millisecondsSinceEpoch});
      // Pong watchdog: no frame at all for 2.5 intervals while we're
      // clearly heartbeating means the socket is a ghost (dead NAT
      // mapping). Reconnect NOW instead of waiting for TCP to notice —
      // which, without a FIN/RST, can take 15+ minutes.
      final silentFor =
          DateTime.now().difference(_lastFrameAt);
      if (silentFor > _pingInterval * 2.5) {
        _onDone();
      }
    });
  }

  void _stopHeartbeater() {
    _heartbeater?.cancel();
    _heartbeater = null;
  }

  void _setStatus(WsStatus s) {
    if (_statusValue == s) return;
    _statusValue = s;
    if (!_status.isClosed) _status.add(s);
  }

  /// Mark connected + reset backoff — called by the owner after it
  /// receives its first handshake frame (e.g. `hello` / `registered`).
  void confirmConnected() {
    _attempts = 0;
    _setStatus(WsStatus.connected);
  }

  /// Immediate reconnect (app resumed from background, token rotated).
  void reconnectNow() {
    if (_disposed) return;
    _attempts = 0;
    _stopHeartbeater();
    _teardownChannel();
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _setStatus(WsStatus.disconnected);
    connect();
  }

  /// Sends a JSON envelope. Returns false when the socket isn't open.
  bool send(String type, [Map<String, dynamic> data = const {}]) {
    final channel = _channel;
    if (channel == null || !isConnected) return false;
    try {
      channel.sink.add(jsonEncode({'type': type, ...data}));
      return true;
    } catch (_) {
      return false;
    }
  }

  void dispose() {
    _disposed = true;
    _stopHeartbeater();
    _reconnectTimer?.cancel();
    _teardownChannel();
    _events.close();
    _status.close();
  }
}
