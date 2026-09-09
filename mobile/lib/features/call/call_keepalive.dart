import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Native call foreground service (Android) — started while a call is
/// live, stopped when it ends.
///
/// Why: the moment the screen blanks (proximity sensor while held to
/// the ear) Android caches/freezes a backgrounded process with no
/// foreground service — the `/ws-call` WebSocket's heartbeat AND its
/// protocol-level auto-pong stop. The server's idle timeout then closed
/// the socket exactly 90s into the call, tearing the customer's side
/// down and leaving the agent's (frozen) app showing a zombie call.
/// The microphone service type also keeps mic capture legal while
/// backgrounded (Android 9+ silently mutes backgrounded apps).
///
/// Mirrors [DutyModeService] plumbing (`datxevui/callfg` channel); the
/// service itself is a dumb notification + wake-lock holder. Failures
/// are non-fatal by design: a vendor FGS denial must never crash the
/// call — worst case we fall back to pre-fix behaviour.
class CallKeepAlive {
  static const _kChannel = MethodChannel('datxevui/callfg');

  static bool _running = false;

  /// Whether the native service is currently believed to be running.
  static bool get isRunning => _running;

  /// Start the call keep-alive service (no-op off Android / on failure).
  static Future<void> start() async {
    if (_running) return;
    if (defaultTargetPlatform != TargetPlatform.android) return;
    try {
      await _kChannel.invokeMethod<bool?>('start');
      _running = true;
    } on PlatformException catch (e) {
      debugPrint('call-keepalive start failed: ${e.message}');
    } on MissingPluginException {
      // Older embedder — service unavailable, degrade silently.
    }
  }

  /// Stop the call keep-alive service (idempotent).
  static Future<void> stop() async {
    if (!_running) return;
    _running = false;
    if (defaultTargetPlatform != TargetPlatform.android) return;
    try {
      await _kChannel.invokeMethod<bool?>('stop');
    } on PlatformException catch (e) {
      debugPrint('call-keepalive stop failed: ${e.message}');
    } on MissingPluginException {
      // Ignore.
    }
  }
}
