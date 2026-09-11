import 'package:flutter/foundation.dart';

/// Call lifecycle, mirroring the web client's state machine.
enum CallStatus {
  /// No call.
  idle,

  /// Outbound — waiting for the peer to answer (ringing).
  calling,

  /// Inbound — ringing, the agent hasn't accepted yet.
  incoming,

  /// Answered — ICE negotiation in progress.
  connecting,

  /// Live call.
  active,

  /// Just ended — brief "Call ended" display before returning to idle.
  ended,
}

/// Immutable call UI state, driven by [CallController].
@immutable
class CallUiState {
  const CallUiState({
    this.status = CallStatus.idle,
    this.peerId,
    this.peerName = '',
    this.channelId,
    this.remoteOffer,
    this.startedAt,
    this.micEnabled = true,
    this.speakerOn = false,
    this.endedReason,
    this.error,
  });

  final CallStatus status;

  /// The peer's user id (learned from `incoming.from` / `answer.from`,
  /// or the explicit target for agent-initiated calls). All hangup + ICE
  /// routing goes to THIS id — never the literal 'agent'.
  final String? peerId;

  final String peerName;
  final String? channelId;

  /// The pending SDP offer while `incoming` (JSON: `{type, sdp}`).
  final Map<String, dynamic>? remoteOffer;

  /// Set when `active` — drives the duration timer.
  final DateTime? startedAt;

  final bool micEnabled;
  final bool speakerOn;

  final String? endedReason;
  final String? error;

  bool get inCall =>
      status == CallStatus.incoming ||
      status == CallStatus.calling ||
      status == CallStatus.connecting ||
      status == CallStatus.active;

  CallUiState copyWith({
    CallStatus? status,
    String? peerId,
    String? peerName,
    String? channelId,
    Map<String, dynamic>? remoteOffer,
    DateTime? startedAt,
    bool? micEnabled,
    bool? speakerOn,
    String? endedReason,
    String? error,
    bool clearOffer = false,
    bool clearError = false,
    bool clearReason = false,
  }) =>
      CallUiState(
        status: status ?? this.status,
        peerId: peerId ?? this.peerId,
        peerName: peerName ?? this.peerName,
        channelId: channelId ?? this.channelId,
        remoteOffer: clearOffer ? null : (remoteOffer ?? this.remoteOffer),
        startedAt: startedAt ?? this.startedAt,
        micEnabled: micEnabled ?? this.micEnabled,
        speakerOn: speakerOn ?? this.speakerOn,
        endedReason: clearReason ? null : (endedReason ?? this.endedReason),
        error: clearError ? null : (error ?? this.error),
      );
}

/// Default STUN servers when the backend pushes none via
/// `AUDIO_CALL_ICE_SERVERS` (production behind strict NATs should set TURN).
const defaultIceServers = <Map<String, dynamic>>[
  {'urls': 'stun:stun.l.google.com:19302'},
  {'urls': 'stun:stun1.l.google.com:19302'},
];

/// Parses raw JSON or List into typed ICE server config maps.
List<Map<String, dynamic>> parseIceServers(dynamic raw) {
  if (raw is! List) return const [];
  final servers = <Map<String, dynamic>>[];
  for (final item in raw) {
    if (item is Map) {
      servers.add(Map<String, dynamic>.from(item));
    }
  }
  return servers;
}
