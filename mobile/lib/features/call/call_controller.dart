import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../../core/audio/sound_service.dart';
import '../../core/net/ws_client.dart' show WsStatus;
import '../chat/conversations_controller.dart';
import 'call_engine.dart';
import 'call_keepalive.dart';
import 'call_signaling.dart';
import 'call_state.dart';

/// Global call state machine — inbound AND outbound, one call at a time.
///
/// The controller owns the [CallEngine] (WebRTC) and drives the signaling
/// protocol documented in [CallSignalingService]. UI navigation is NOT
/// done here: `app.dart` listens to state changes and pushes `/call`.
class CallController extends Notifier<CallUiState> {
  CallEngine? _engine;
  StreamSubscription<Map<String, dynamic>>? _sigSub;

  /// Signaling-socket lifecycle — a dropped /ws-call socket means the
  /// call is dead server-side (the server ends every session a dropped
  /// socket carries). Watched to end zombie call UIs immediately.
  StreamSubscription<WsStatus>? _sigStatusSub;

  /// Inbound ring timeout — auto-busy so the customer isn't left hanging.
  Timer? _ringTimer;

  /// Outbound call timeout — nobody picked up.
  Timer? _callTimer;

  /// Post-answer ICE timeout — the call answered but media never
  /// connected (symmetric NAT with no TURN, captive portal, …). Ends
  /// the call with a network-flavoured error instead of sitting on
  /// "connecting" forever until some other timer fires.
  Timer? _connectTimer;

  /// "Call ended" flash duration before returning to idle.
  Timer? _endedTimer;

  Timer? _iceRecoveryTimer;

  /// Grace window the signaling socket gets to come back before an
  /// in-progress call is ended as lost (see [_onSignalingStatus]).
  Timer? _sigLossTimer;

  /// How long the /ws-call socket may be down mid-call before the call
  /// is declared dead — covers the WsClient's exponential backoff
  /// (first retries land in 1–2s) while still ending zombie calls
  /// promptly instead of "running" forever after a freeze.
  static const _sigLossGrace = Duration(seconds: 10);

  /// Set once `RTCPeerConnectionStateConnected` fires — the connect
  /// timeout only applies while this is false.
  bool _mediaConnected = false;

  /// Did WE create the initial offer (mobile-initiated calls)? Only the
  /// offerer may drive an ICE restart (WebRTC glare rule).
  bool _isOfferer = false;

  /// ICE restarts attempted this call (capped at 1).
  int _iceRestarts = 0;

  static const _ringTimeout = Duration(seconds: 30);
  static const _callTimeout = Duration(seconds: 30);
  static const _connectTimeout = Duration(seconds: 20);

  @override
  CallUiState build() {
    final sig = ref.watch(callSignalingProvider);
    ref.onDispose(() {
      _sigSub?.cancel();
      _sigStatusSub?.cancel();
      _ringTimer?.cancel();
      _callTimer?.cancel();
      _connectTimer?.cancel();
      _endedTimer?.cancel();
      _iceRecoveryTimer?.cancel();
      _sigLossTimer?.cancel();
      _teardownEngine();
      CallKeepAlive.stop();
    });
    if (sig == null) return const CallUiState();
    _sigSub = sig.signals.listen(_onSignal, onError: (_) {});
    // The signaling service only buffers ICE candidates while a call is
    // live — give it the predicate (avoids buffering stale noise between
    // calls).
    sig.hasLiveCall = () =>
        state.status != CallStatus.idle && state.status != CallStatus.ended;
    // Signaling-socket loss = call death (server invariant: a dropped
    // socket ends every session it carries). Without this, an employee
    // whose phone lost the socket mid-call (OS froze the app, network
    // switched) kept a zombie "running" call — the end-of-call hangup
    // goes to the OTHER side, never to the socket that dropped.
    _sigStatusSub = sig.connectionStates.listen(_onSignalingStatus);
    return const CallUiState();
  }

  // ── Inbound / outbound entry points ────────────────────────────────

  /// Agent-initiated call to a customer (from the chat room header).
  Future<void> startCall({
    required String customerId,
    required String customerName,
    String? channelId,
  }) async {
    if (state.status != CallStatus.idle) return;
    final sig = ref.read(callSignalingProvider);
    if (sig == null) {
      state = state.copyWith(
        error: 'Chưa kết nối được tổng đài — thử lại sau giây lát',
      );
      return;
    }

    final engine = _freshEngine();
    try {
      await engine.open(_iceServers());
    } catch (_) {
      state = state.copyWith(
        error: 'Không truy cập được micro — kiểm tra quyền ứng dụng',
      );
      _teardownEngine();
      return;
    }

    try {
      final offer = await engine.createOffer();
      final sent = sig.sendOffer(customerId, offer, channelId: channelId);
      if (!sent) throw StateError('signaling not connected');
    } catch (_) {
      state = state.copyWith(error: 'Không gửi được lời mời gọi');
      _teardownEngine();
      return;
    }
    _isOfferer = true;
    _iceRestarts = 0;

    // The mic is open and an offer is out — keep the process alive
    // through screen-blanks from here on (see CallKeepAlive).
    unawaited(CallKeepAlive.start());

    state = CallUiState(
      status: CallStatus.calling,
      peerId: customerId,
      peerName: customerName,
      channelId: channelId,
    );
    // Ringback tone while the customer's device is alerting.
    unawaited(ref.read(soundServiceProvider).startRingback());
    _callTimer = Timer(_callTimeout, () {
      if (state.status == CallStatus.calling) {
        state = state.copyWith(error: 'Không ai nhấc máy — thử lại sau');
        _endCallInternal(reason: 'timeout');
      }
    });
  }

  /// Accept the ringing inbound call.
  Future<void> accept() async {
    if (state.status != CallStatus.incoming || state.remoteOffer == null) {
      return;
    }
    _ringTimer?.cancel();
    _isOfferer = false;
    _iceRestarts = 0;
    // Picking up silences the ring + vibration immediately.
    unawaited(ref.read(soundServiceProvider).stopRinging());
    final sig = ref.read(callSignalingProvider);
    if (sig == null) return;

    final engine = _freshEngine();
    try {
      await engine.open(_iceServers());
      final answer = await engine.acceptOffer(state.remoteOffer!);
      sig.sendAnswer(state.peerId ?? '', answer);
      // Mic open + answer sent — the call is being set up. Hold the
      // process awake from now on so the WS heartbeat survives
      // screen-blanks (CallKeepAlive).
      unawaited(CallKeepAlive.start());
      state = state.copyWith(
        status: CallStatus.connecting,
        clearOffer: true,
        clearError: true,
      );
      _startConnectTimeout();
    } catch (_) {
      state = state.copyWith(
        error: 'Không truy cập được micro — kiểm tra quyền ứng dụng',
      );
      _hangup('remote');
    }
  }

  /// Decline the ringing inbound call.
  void decline() {
    if (state.status != CallStatus.incoming) return;
    _ringTimer?.cancel();
    _hangup('declined', flashEnded: false);
  }

  /// End the current call (user pressed the red button).
  void hangup() => _hangup('remote');

  void toggleMic() {
    final engine = _engine;
    final enabled = !state.micEnabled;
    engine?.setMicEnabled(enabled);
    state = state.copyWith(micEnabled: enabled);
  }

  Future<void> toggleSpeaker() async {
    final on = !state.speakerOn;
    await _engine?.setSpeakerphoneOn(on);
    state = state.copyWith(speakerOn: on);
  }

  // ── Signal handling ────────────────────────────────────────────────

  void _onSignal(Map<String, dynamic> msg) {
    switch (msg['type'] as String?) {
      case 'registered':
        final servers = (msg['iceServers'] as List? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
        final sig = ref.read(callSignalingProvider);
        if (sig != null && servers.isNotEmpty) sig.iceServers = servers;
        _reconcileWithServerCallState(msg['activeCall']);
      case 'incoming':
        _onIncoming(msg);
      case 'answer':
        _onAnswer(msg);
      case 'renegotiate':
        _onRenegotiate(msg);
      case 'ice':
        _onIce(msg);
      case 'hangup':
        _onRemoteHangup(msg);
      case 'error':
        _onServerError(msg);
    }
  }

  /// ICE restart from the peer (always the original OFFERER — the web
  /// customer, or us for mobile-initiated calls): apply the re-offer to
  /// the EXISTING engine and answer, or apply their answer to our restart.
  /// Never re-rings, never a new call — this is the recovery path for
  /// corporate NATs / IP churn that invalidated the original candidates.
  void _onRenegotiate(Map<String, dynamic> msg) {
    final sdp = msg['sdp'];
    if (sdp is! Map) return;
    final engine = _engine;
    if (engine == null || !state.inCall) return;
    final from = msg['from'] as String? ?? state.peerId;
    final kind = msg['kind'] as String?;
    final sig = ref.read(callSignalingProvider);
    if (from == null || sig == null) return;

    if (kind == 'offer') {
      unawaited(
        engine
            .acceptRenegotiateOffer(Map<String, dynamic>.from(sdp))
            .then((answer) {
          sig.sendRenegotiateAnswer(from, answer);
          // Fresh candidates are coming — extend the media deadline so a
          // slow restart isn't killed by the old timer.
          _startConnectTimeout();
        }).catchError((_) {
          _hangup('remote');
        }),
      );
    } else if (kind == 'answer') {
      engine
          .setRemoteAnswer(Map<String, dynamic>.from(sdp))
          .catchError((_) {});
      _startConnectTimeout();
    }
  }

  /// Reconcile the local call UI against the server's session truth.
  ///
  /// `registered.activeCall` is the LIVE session the server has for this
  /// user (or `null`). Every reconnect re-registers — so a client whose
  /// socket dropped mid-call (and whose call the server therefore ended)
  /// learns here, on the very first frame after reconnecting, that its
  /// call UI is a zombie and must end now. The hangup that ended the
  /// session was sent to the OTHER side and to this user's OTHER
  /// sockets — a socket that reconnected would otherwise never hear
  /// about it and would show "in call" forever.
  void _reconcileWithServerCallState(Object? activeCall) {
    final status = state.status;
    final inCall = status == CallStatus.calling ||
        status == CallStatus.connecting ||
        status == CallStatus.active;
    if (!inCall) return;
    if (activeCall is Map && activeCall['peerId'] is String) {
      // The server still has a live session for us — keep the call (a
      // transient WS blip that reconnected does not end the call; the
      // audio is peer-to-peer and only this reconciliation decides).
      return;
    }
    _endCallInternal(
      error: 'Mất kết nối cuộc gọi — đã kết thúc',
    );
  }

  /// Signaling-socket lifecycle: a socket that DROPS while we're in a
  /// call almost always means the server has ended the session it
  /// carried (its end-of-call hangup went to the peer). Rather than
  /// killing the call on a 2-second network blip, give the auto-reconnect
  /// a grace window: if the socket comes back, the `registered`
  /// reconciliation above decides with server truth; if it doesn't, the
  /// call ends here instead of zombie-ing until the user notices.
  void _onSignalingStatus(WsStatus status) {
    if (status == WsStatus.connected) {
      // Socket is back — the registered reconciliation is now in charge.
      _sigLossTimer?.cancel();
      _sigLossTimer = null;
      return;
    }
    if (status != WsStatus.disconnected && status != WsStatus.backoff) {
      return;
    }
    final s = state.status;
    if (s != CallStatus.connecting && s != CallStatus.active) return;
    // Arm once per outage (status flapping between disconnected/backoff
    // must NOT push the deadline out forever) — only `connected` cancels.
    if (_sigLossTimer != null) return;
    _sigLossTimer = Timer(_sigLossGrace, () {
      _sigLossTimer = null;
      final cur = state.status;
      if (cur == CallStatus.connecting || cur == CallStatus.active) {
        _endCallInternal(
          error: 'Mất kết nối với máy chủ — cuộc gọi đã kết thúc',
        );
      }
    });
  }

  void _onIncoming(Map<String, dynamic> msg) {
    // Busy guard: one call at a time. Auto-reject so the caller gets an
    // immediate answer instead of ringing into a void.
    if (state.status != CallStatus.idle) {
      ref.read(callSignalingProvider)?.hangup(
            msg['from'] as String? ?? '',
            'busy',
          );
      return;
    }
    final from = msg['from'] as String?;
    final sdp = msg['sdp'];
    if (from == null || sdp is! Map) return;

    final channelId = msg['channelId'] as String?;
    final peerName = _resolveName(channelId);

    state = CallUiState(
      status: CallStatus.incoming,
      peerId: from,
      peerName: peerName,
      channelId: channelId,
      remoteOffer: Map<String, dynamic>.from(sdp),
    );
    // Ring + vibrate (AgentAlerts also shows a notification when the
    // app is backgrounded).
    unawaited(ref.read(soundServiceProvider).startIncomingRing());
    _ringTimer = Timer(_ringTimeout, () {
      if (state.status == CallStatus.incoming) {
        _hangup('busy', flashEnded: false);
      }
    });
  }

  void _onAnswer(Map<String, dynamic> msg) {
    if (state.status != CallStatus.calling) return;
    final sdp = msg['sdp'];
    if (sdp is! Map) return;
    _callTimer?.cancel();
    unawaited(ref.read(soundServiceProvider).stopRinging());
    final from = msg['from'] as String?;
    // The caller learns the agent's real id here.
    state = state.copyWith(
      status: CallStatus.active,
      peerId: from ?? state.peerId,
      startedAt: DateTime.now(),
      clearError: true,
    );
    unawaited(ref.read(soundServiceProvider).playCallJoined());
    _engine?.setRemoteAnswer(Map<String, dynamic>.from(sdp)).catchError((_) {});
    // The caller jumps straight to `active` on the answer — media may
    // still be negotiating. Same guard as the callee's `connecting`.
    _startConnectTimeout();
  }

  void _onIce(Map<String, dynamic> msg) {
    if (!_engineExists) return;
    final candidate = msg['candidate'];
    if (candidate is! Map) return;
    _engine?.addRemoteCandidate(
      Map<String, dynamic>.from(candidate),
    ).catchError((_) {});
  }

  void _onRemoteHangup(Map<String, dynamic> msg) {
    final reason = msg['reason'] as String? ?? 'remote';
    _endCallInternal(reason: _reasonText(reason));
  }

  void _onServerError(Map<String, dynamic> msg) {
    final code = msg['code'] as String? ?? '';
    // Terminal call-setup errors — stop ringing and release the mic.
    // `customer-busy`/`agent-busy`: the server-side session guard rejected
    // a second call for someone already in one. `no-session`: the call was
    // re-routed away before this answer arrived.
    const terminal = {
      'no-agent',
      'agents-busy',
      'peer-unavailable',
      'customer-busy',
      'agent-busy',
      'peer-busy',
      'no-session',
    };
    if (terminal.contains(code) && state.status != CallStatus.idle) {
      final text = switch (code) {
        'peer-unavailable' => 'Khách hàng không trực tuyến',
        'customer-busy' => 'Bạn đang trong cuộc gọi khác',
        'agent-busy' => 'Bạn đang trong cuộc gọi khác',
        'peer-busy' => 'Khách đang trong cuộc gọi khác',
        'no-agent' => 'Không có nhân viên trực — thử lại sau',
        _ => 'Không kết nối được — thử lại sau',
      };
      _endCallInternal(reason: null, error: text);
    }
  }

  // ── Engine wiring ──────────────────────────────────────────────────

  List<Map<String, dynamic>> _iceServers() {
    final sig = ref.read(callSignalingProvider);
    final servers = sig?.iceServers ?? const [];
    return servers.isNotEmpty ? servers : defaultIceServers;
  }

  bool get _engineExists => _engine != null;

  CallEngine _freshEngine() {
    _teardownEngine();
    _mediaConnected = false;
    final engine = CallEngine()
      ..onLocalCandidate = (candidate) {
        final peer = state.peerId;
        if (peer != null) {
          ref.read(callSignalingProvider)?.sendIce(peer, candidate);
        }
      }
      ..onConnectionState = (s) => _onConnectionState(s);
    _engine = engine;
    return engine;
  }

  void _onConnectionState(RTCPeerConnectionState s) {
    if (s == RTCPeerConnectionState.RTCPeerConnectionStateConnected) {
      _mediaConnected = true;
      // The answering side never gets an `answer` frame — the connection
      // state is its only "call is live" signal.
      if (state.status == CallStatus.connecting) {
        _connectTimer?.cancel();
        state = state.copyWith(
          status: CallStatus.active,
          startedAt: DateTime.now(),
          clearError: true,
        );
      }
      _iceRecoveryTimer?.cancel();
    } else if (s == RTCPeerConnectionState.RTCPeerConnectionStateFailed ||
        s == RTCPeerConnectionState.RTCPeerConnectionStateDisconnected) {
      // ICE hiccup — give it 3s to recover, then either restart ICE
      // (once, OFFERER-only — the office-network case where the media
      // path never came up or died mid-negotiation) or hang up.
      _iceRecoveryTimer?.cancel();
      _iceRecoveryTimer = Timer(const Duration(seconds: 3), () {
        final current = state;
        if (current.status == CallStatus.active ||
            current.status == CallStatus.connecting) {
          if (_isOfferer && _iceRestarts < 1) {
            _restartIce();
          } else {
            _hangup('remote');
          }
        }
      });
    }
  }

  /// OFFERER-only ICE restart: re-offer with `iceRestart: true` on the
  /// SAME engine; the server relays it as `renegotiate`, the peer
  /// re-answers, and a fresh candidate set + media deadline get a second
  /// chance. This is the recovery path for corporate NATs that block the
  /// original candidate pair — without it the call dies at the first ICE
  /// failure even though a TURN relay path exists.
  void _restartIce() {
    final engine = _engine;
    final peer = state.peerId;
    final sig = ref.read(callSignalingProvider);
    if (engine == null || peer == null || peer.isEmpty || sig == null) {
      _hangup('remote');
      return;
    }
    _iceRestarts++;
    _connectTimer?.cancel();
    unawaited(
      engine.createRestartOffer().then((offer) {
        if (state.status != CallStatus.active &&
            state.status != CallStatus.connecting) {
          return; // call ended while re-offering
        }
        if (!sig.sendRenegotiateOffer(peer, offer)) {
          _hangup('remote');
          return;
        }
        _startConnectTimeout();
      }).catchError((_) {
        _hangup('remote');
      }),
    );
  }

  // ── Teardown ───────────────────────────────────────────────────────

  void _hangup(String reason, {bool flashEnded = true}) {
    final peer = state.peerId;
    // An AGENT must never send `to: 'agent'` — that id doesn't exist in
    // the hub and the hangup would be dropped.
    if (peer != null && peer.isNotEmpty) {
      ref.read(callSignalingProvider)?.hangup(peer, reason);
    }
    _endCallInternal(
      reason: flashEnded ? _reasonText(reason) : null,
      flashEnded: flashEnded,
    );
  }

  /// Post-answer guard: media must connect within [_connectTimeout] —
  /// otherwise the call is dead ("connecting…" forever) and we end it
  /// with a clear network error. Applies to BOTH sides: the callee sits
  /// in `connecting`, the caller jumps to `active` before media flows.
  void _startConnectTimeout() {
    _connectTimer?.cancel();
    _connectTimer = Timer(_connectTimeout, () {
      if (!_mediaConnected &&
          (state.status == CallStatus.connecting ||
              state.status == CallStatus.active)) {
        _endCallInternal(
          reason: null,
          error:
              'Không kết nối được âm thanh — mạng hiện tại có thể chặn cuộc gọi (thử mạng khác, tắt VPN hoặc kiểm tra firewall công ty)',
        );
        // Tell the peer we're gone so their side doesn't ring on.
        final sig = ref.read(callSignalingProvider);
        final peer = state.peerId;
        if (peer != null && peer.isNotEmpty) {
          sig?.hangup(peer, 'timeout');
        }
      }
    });
  }

  void _endCallInternal({String? reason, String? error, bool flashEnded = true}) {
    _callTimer?.cancel();
    _ringTimer?.cancel();
    _connectTimer?.cancel();
    _iceRecoveryTimer?.cancel();
    _sigLossTimer?.cancel();
    _isOfferer = false;
    _iceRestarts = 0;
    // Kill the ring/ringback + haptics before anything else.
    unawaited(ref.read(soundServiceProvider).stopAll());
    _teardownEngine();
    // Call over — the keep-alive foreground service is no longer needed
    // (and holding a mic-type FGS after the call ends would keep the
    // notification + wake lock alive pointlessly).
    unawaited(CallKeepAlive.stop());
    if (!flashEnded) {
      state = const CallUiState();
      return;
    }
    state = state.copyWith(
      status: CallStatus.ended,
      endedReason: reason,
      error: error,
      clearOffer: true,
    );
    unawaited(ref.read(soundServiceProvider).playCallEnded());
    _endedTimer = Timer(const Duration(milliseconds: 2500), () {
      if (state.status == CallStatus.ended) {
        state = const CallUiState();
      }
    });
  }

  void _teardownEngine() {
    _engine?.close();
    _engine = null;
  }

  // ── Helpers ────────────────────────────────────────────────────────

  /// Resolve the caller's display name from the queue snapshot.
  String _resolveName(String? channelId) {
    if (channelId == null) return 'Khách hàng';
    final channels = ref.read(conversationsProvider).value;
    if (channels == null) return 'Khách hàng';
    for (final c in channels) {
      if (c.id == channelId) return c.displayName;
    }
    return 'Khách hàng';
  }

  static String _reasonText(String reason) {
    switch (reason) {
      case 'busy':
        return 'Bận — khách đang trong cuộc gọi khác';
      case 'declined':
        return 'Đã từ chối cuộc gọi';
      case 'timeout':
        return 'Không ai nhấc máy';
      default:
        return 'Cuộc gọi đã kết thúc';
    }
  }
}

final callUiStateProvider =
    NotifierProvider<CallController, CallUiState>(CallController.new);

/// Exposed for the app-level navigation listener (pushes/pops `/call`).
enum CallNav { none, showCall, dismissCall }

/// Derives a navigation command from call-state transitions.
final callNavProvider = Provider<CallNav>((ref) {
  final status = ref.watch(callUiStateProvider.select((s) => s.status));
  switch (status) {
    case CallStatus.incoming:
    case CallStatus.calling:
    case CallStatus.connecting:
    case CallStatus.active:
      return CallNav.showCall;
    case CallStatus.ended:
    case CallStatus.idle:
      return CallNav.dismissCall;
  }
});
