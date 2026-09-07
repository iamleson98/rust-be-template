import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../chat/conversations_controller.dart';
import 'call_engine.dart';
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

  /// Inbound ring timeout — auto-busy so the customer isn't left hanging.
  Timer? _ringTimer;

  /// Outbound call timeout — nobody picked up.
  Timer? _callTimer;

  /// "Call ended" flash duration before returning to idle.
  Timer? _endedTimer;

  Timer? _iceRecoveryTimer;

  static const _ringTimeout = Duration(seconds: 30);
  static const _callTimeout = Duration(seconds: 30);

  @override
  CallUiState build() {
    final sig = ref.watch(callSignalingProvider);
    ref.onDispose(() {
      _sigSub?.cancel();
      _ringTimer?.cancel();
      _callTimer?.cancel();
      _endedTimer?.cancel();
      _iceRecoveryTimer?.cancel();
      _teardownEngine();
    });
    if (sig == null) return const CallUiState();
    _sigSub = sig.signals.listen(_onSignal, onError: (_) {});
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

    state = CallUiState(
      status: CallStatus.calling,
      peerId: customerId,
      peerName: customerName,
      channelId: channelId,
    );
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
    final sig = ref.read(callSignalingProvider);
    if (sig == null) return;

    final engine = _freshEngine();
    try {
      await engine.open(_iceServers());
      final answer = await engine.acceptOffer(state.remoteOffer!);
      sig.sendAnswer(state.peerId ?? '', answer);
      state = state.copyWith(
        status: CallStatus.connecting,
        clearOffer: true,
        clearError: true,
      );
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
      case 'incoming':
        _onIncoming(msg);
      case 'answer':
        _onAnswer(msg);
      case 'ice':
        _onIce(msg);
      case 'hangup':
        _onRemoteHangup(msg);
      case 'error':
        _onServerError(msg);
    }
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
    final from = msg['from'] as String?;
    // The caller learns the agent's real id here.
    state = state.copyWith(
      status: CallStatus.active,
      peerId: from ?? state.peerId,
      startedAt: DateTime.now(),
      clearError: true,
    );
    _engine?.setRemoteAnswer(Map<String, dynamic>.from(sdp)).catchError((_) {});
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
    const terminal = {'no-agent', 'agents-busy', 'peer-unavailable'};
    if (terminal.contains(code) && state.status != CallStatus.idle) {
      final text = code == 'peer-unavailable'
          ? 'Khách hàng không trực tuyến'
          : 'Không kết nối được — thử lại sau';
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
      // The answering side never gets an `answer` frame — the connection
      // state is its only "call is live" signal.
      if (state.status == CallStatus.connecting) {
        state = state.copyWith(
          status: CallStatus.active,
          startedAt: DateTime.now(),
          clearError: true,
        );
      }
      _iceRecoveryTimer?.cancel();
    } else if (s == RTCPeerConnectionState.RTCPeerConnectionStateFailed ||
        s == RTCPeerConnectionState.RTCPeerConnectionStateDisconnected) {
      // ICE hiccup — give it 3s to recover, then hang up.
      _iceRecoveryTimer?.cancel();
      _iceRecoveryTimer = Timer(const Duration(seconds: 3), () {
        final current = state;
        if (current.status == CallStatus.active ||
            current.status == CallStatus.connecting) {
          _hangup('remote');
        }
      });
    }
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

  void _endCallInternal({String? reason, String? error, bool flashEnded = true}) {
    _callTimer?.cancel();
    _ringTimer?.cancel();
    _iceRecoveryTimer?.cancel();
    _teardownEngine();
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
