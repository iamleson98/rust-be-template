import 'package:flutter_webrtc/flutter_webrtc.dart';

/// One WebRTC session (audio-only).
///
/// Signaling is owned by [CallController] (via `/ws-call`); this engine
/// owns the media side: mic capture, `RTCPeerConnection`, trickle ICE,
/// and cleanup. Remote audio **plays automatically on Android/iOS** once
/// the remote track arrives (no renderer needed for audio; video would
/// use `RTCVideoView`).
class CallEngine {
  RTCPeerConnection? _pc;
  MediaStream? _localStream;
  bool _closed = false;

  /// Local ICE candidate (trickle) → relay via signaling.
  void Function(Map<String, dynamic> candidate)? onLocalCandidate;

  /// Peer connection state transitions.
  void Function(RTCPeerConnectionState state)? onConnectionState;

  /// Remote media arrived (audio plays natively; hook for future video).
  void Function(MediaStream stream)? onRemoteStream;

  bool get isClosed => _closed;

  /// Captures the mic and creates the peer connection.
  ///
  /// Echo cancellation + noise suppression + AGC are critical on
  /// mobile speakers.
  Future<void> open(List<Map<String, dynamic>> iceServers) async {
    if (_closed) return;
    final local = await navigator.mediaDevices.getUserMedia(<String, dynamic>{
      'audio': <String, dynamic>{
        'echoCancellation': true,
        'noiseSuppression': true,
        'autoGainControl': true,
      },
      'video': false,
    });
    _localStream = local;

    final pc = await createPeerConnection(<String, dynamic>{
      'iceServers': iceServers,
      'sdpSemantics': 'unified-plan',
    });
    _pc = pc;

    for (final track in local.getAudioTracks()) {
      await pc.addTrack(track, local);
    }

    pc.onIceCandidate = (candidate) {
      if (_closed || candidate.candidate == null) return;
      onLocalCandidate?.call(<String, dynamic>{
        'candidate': candidate.candidate,
        'sdpMid': candidate.sdpMid,
        'sdpMLineIndex': candidate.sdpMLineIndex,
      });
    };

    pc.onTrack = (event) {
      if (_closed) return;
      final stream = event.streams.isNotEmpty ? event.streams.first : null;
      if (stream != null) onRemoteStream?.call(stream);
    };

    pc.onConnectionState = (s) {
      if (!_closed) onConnectionState?.call(s);
    };
  }

  /// Caller path: create the SDP offer (already has local description set).
  Future<Map<String, dynamic>> createOffer() async {
    final pc = _pc!;
    final offer = await pc.createOffer(<String, dynamic>{
      'offerToReceiveAudio': 1,
      'offerToReceiveVideo': 0,
    });
    await pc.setLocalDescription(offer);
    return <String, dynamic>{'type': offer.type, 'sdp': offer.sdp};
  }

  /// Callee path: apply the remote offer and answer it.
  Future<Map<String, dynamic>> acceptOffer(Map<String, dynamic> sdpJson) async {
    final pc = _pc!;
    await pc.setRemoteDescription(
      RTCSessionDescription(sdpJson['sdp'] as String?, sdpJson['type'] as String?),
    );
    final answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return <String, dynamic>{'type': answer.type, 'sdp': answer.sdp};
  }

  /// Caller path: apply the remote answer.
  Future<void> setRemoteAnswer(Map<String, dynamic> sdpJson) async {
    await _pc?.setRemoteDescription(
      RTCSessionDescription(sdpJson['sdp'] as String?, sdpJson['type'] as String?),
    );
  }

  Future<void> addRemoteCandidate(Map<String, dynamic> json) async {
    await _pc?.addCandidate(
      RTCIceCandidate(
        json['candidate'] as String?,
        json['sdpMid'] as String?,
        (json['sdpMLineIndex'] as num?)?.toInt(),
      ),
    );
  }

  /// Mute/unmute the outbound track (the peer keeps receiving silence
  /// frames — the connection stays up).
  void setMicEnabled(bool enabled) {
    for (final track in _localStream?.getAudioTracks() ?? <MediaStreamTrack>[]) {
      track.enabled = enabled;
    }
  }

  /// Route audio to the earpiece or the loudspeaker.
  Future<void> setSpeakerphoneOn(bool on) async {
    try {
      await Helper.setSpeakerphoneOn(on);
    } catch (_) {
      // Not supported on this platform (e.g. web) — non-fatal.
    }
  }

  /// Tears the session down: close the PC, release the mic. Safe to call
  /// multiple times.
  void close() {
    if (_closed) return;
    _closed = true;
    onLocalCandidate = null;
    onConnectionState = null;
    onRemoteStream = null;
    try {
      _pc?.close();
      _pc?.dispose();
    } catch (_) {}
    try {
      _localStream?.dispose();
    } catch (_) {}
    _pc = null;
    _localStream = null;
  }
}
