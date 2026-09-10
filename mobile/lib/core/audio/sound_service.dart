import 'dart:async';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:vibration/vibration.dart';

import '../settings.dart';

/// In-app messenger sounds + haptics.
///
/// Real tunes, no synthesised beeps — every asset under `assets/sounds/`
/// is a production notification sound from an Apache-2.0 project:
///
///   * `message.mp3`    — Google AOSP "Pixie Dust" (new message)
///   * `request.mp3`    — Google AOSP "Tweeters" (new support request)
///   * `ring.mp3`       — Google AOSP Material "Titania" (incoming call)
///   * `ringback.mp3`   — Jitsi Meet ringback (outbound call)
///   * `call_joined.mp3`/`call_ended.mp3` — Jitsi Meet join/leave cues
///
/// See `assets/sounds/ATTRIBUTION.md` for the full notice.
///
/// Usage:
///   * [playMessage] / [playRequest] — one-shot cues (+ short haptic)
///   * [startIncomingRing] — loops `ring.mp3` + a repeating "ring-ring"
///     vibration pattern until [stopRinging]
///   * [startRingback] — the tone the agent hears while an outbound call
///     is unanswered
///
/// Two separate [AudioPlayer]s are used: short cues share one (each play
/// restarts it), while the ring/ringback player must support looping and
/// independent stop.
class SoundService {
  SoundService(this._ref) {
    _ringPlayer.onPlayerComplete.listen((_) {
      // Looping is set via ReleaseMode; this is a safety net only.
      if (_ringMode == _RingMode.incoming) _restartRing();
    });
  }

  final Ref _ref;

  final AudioPlayer _cuePlayer = AudioPlayer(playerId: 'vexevn_cues');
  final AudioPlayer _ringPlayer = AudioPlayer(playerId: 'vexevn_ring');

  _RingMode _ringMode = _RingMode.none;
  Timer? _vibrateTimer;

  bool get _alertsOn => _ref.read(alertsEnabledProvider);
  bool get _soundOn => _ref.read(alertsEnabledProvider) &&
      _ref.read(soundEnabledProvider);
  bool get _vibrateOn => _ref.read(alertsEnabledProvider) &&
      _ref.read(vibrateEnabledProvider);

  // ── One-shot cues ──────────────────────────────────────────────────

  /// New customer message (while the room isn't open) — "Pixie Dust".
  Future<void> playMessage() async {
    _hapticPulse();
    if (!_soundOn) return;
    try {
      await _cuePlayer.stop();
      await _cuePlayer.play(
        AssetSource('sounds/message.mp3'),
        volume: 0.9,
      );
    } catch (e) {
      debugPrint('[sound] message cue failed: $e');
    }
  }

  /// New support request in the queue — "Tweeters" (bird chirp).
  Future<void> playRequest() async {
    _hapticPulse();
    if (!_soundOn) return;
    try {
      await _cuePlayer.stop();
      await _cuePlayer.play(
        AssetSource('sounds/request.mp3'),
        volume: 0.9,
      );
    } catch (e) {
      debugPrint('[sound] request cue failed: $e');
    }
  }

  /// Both call sides just connected — soft join cue.
  Future<void> playCallJoined() async {
    if (!_soundOn) return;
    try {
      await _cuePlayer.stop();
      await _cuePlayer.play(
        AssetSource('sounds/call_joined.mp3'),
        volume: 0.8,
      );
    } catch (_) {}
  }

  /// Call finished (any reason) — soft leave cue.
  Future<void> playCallEnded() async {
    if (!_soundOn) return;
    try {
      await _cuePlayer.stop();
      await _cuePlayer.play(
        AssetSource('sounds/call_ended.mp3'),
        volume: 0.8,
      );
    } catch (_) {}
  }

  // ── Ring loops ─────────────────────────────────────────────────────

  /// Incoming call: loop the "Titania" ringtone + repeating vibration
  /// until [stopRinging]. Safe to call repeatedly.
  Future<void> startIncomingRing() async {
    if (!_alertsOn) return;
    if (_ringMode == _RingMode.incoming) return;
    await _startRing(_RingMode.incoming, 'sounds/ring.mp3');
    _startVibrateLoop();
  }

  /// Outbound call waiting for pickup: loop the Jitsi ringback tone.
  /// (No vibration — the agent initiated it.)
  Future<void> startRingback() async {
    if (!_soundOn) return;
    if (_ringMode == _RingMode.ringback) return;
    await _startRing(_RingMode.ringback, 'sounds/ringback.mp3');
  }

  /// Stop the ring / ringback loop + vibration. Always safe to call.
  Future<void> stopRinging() async {
    _vibrateTimer?.cancel();
    _vibrateTimer = null;
    if (_ringMode == _RingMode.none) return;
    _ringMode = _RingMode.none;
    try {
      await _ringPlayer.stop();
    } catch (_) {}
  }

  /// Stop every sound (used on teardown / logout).
  Future<void> stopAll() async {
    await stopRinging();
    try {
      await _cuePlayer.stop();
    } catch (_) {}
  }

  // ── Preview ────────────────────────────────────────────────────────

  /// Settings-screen preview: plays the message cue so the agent knows
  /// exactly what to expect.
  Future<void> preview() async {
    try {
      await _cuePlayer.stop();
      await _cuePlayer.play(
        AssetSource('sounds/message.mp3'),
        volume: 1.0,
      );
    } catch (_) {}
  }

  // ── Internals ──────────────────────────────────────────────────────

  Future<void> _startRing(_RingMode mode, String asset) async {
    _ringMode = mode;
    try {
      await _ringPlayer.stop();
      await _ringPlayer.setAudioContext(
        AudioContext(
          iOS: AudioContextIOS(
            category: AVAudioSessionCategory.playback,
          ),
        ),
      );
      await _ringPlayer.setReleaseMode(ReleaseMode.loop);
      await _ringPlayer.play(AssetSource(asset), volume: 1.0);
    } catch (e) {
      debugPrint('[sound] ring failed: $e');
      _ringMode = _RingMode.none;
    }
  }

  Future<void> _restartRing() async {
    if (_ringMode == _RingMode.none) return;
    try {
      await _ringPlayer.stop();
      await _ringPlayer.setReleaseMode(ReleaseMode.loop);
      await _ringPlayer.resume();
    } catch (_) {}
  }

  /// Messenger-style repeating haptic: two 1s buzzes every 2.2s — like
  /// an incoming WhatsApp call. Implemented with a timer (rather than
  /// the plugin's `repeat` flag) so iOS behaves identically and stopping
  /// is deterministic.
  void _startVibrateLoop() {
    _vibrateTimer?.cancel();
    if (!_vibrateOn) return;
    unawaited(() async {
      if (!await _deviceCanVibrate()) return;
      _vibrateTimer =
          Timer.periodic(const Duration(milliseconds: 2200), (_) {
        if (!_vibrateOn) return;
        unawaited(() async {
          try {
            await Vibration.vibrate(
              pattern: const [0, 1000, 300, 1000],
              repeat: -1,
            );
          } catch (_) {}
        }());
      });
    }());
  }

  /// Short double-tap haptic for a new message.
  void _hapticPulse() {
    if (!_vibrateOn) return;
    unawaited(() async {
      if (!await _deviceCanVibrate()) return;
      try {
        await Vibration.vibrate(
          pattern: const [0, 60, 80, 60],
          repeat: -1,
        );
      } catch (_) {}
    }());
  }

  Future<bool> _deviceCanVibrate() async {
    try {
      return await Vibration.hasVibrator();
    } catch (_) {
      return false;
    }
  }

  Future<void> dispose() async {
    _vibrateTimer?.cancel();
    await _cuePlayer.dispose();
    await _ringPlayer.dispose();
  }
}

enum _RingMode { none, incoming, ringback }

final soundServiceProvider = Provider<SoundService>((ref) {
  final service = SoundService(ref);
  ref.onDispose(service.dispose);
  return service;
});
