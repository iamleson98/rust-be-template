import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// "Duty mode" — the Android foreground service that keeps the app
/// process (and with it the chat + `/ws-call` WebSockets and the
/// notification service) alive while the agent is on duty.
///
/// With duty mode ON:
///   * swiping the app away does NOT kill the process — the socket
///     stays connected, incoming calls keep ringing (ringtone +
///     vibration + notification) exactly as they do in the background;
///   * a partial wake lock keeps the CPU awake for the WS heartbeat
///     during Doze;
///   * the service restarts (START_STICKY) if the system reclaims the
///     process anyway.
///
/// Force-stop from App Settings still kills everything — that case is
/// covered by FCM push once `FCM_CREDENTIALS_JSON` is configured
/// server-side (see the backend README push section).
///
/// iOS: no equivalent without PushKit/CallKit + APNs (documented
/// upgrade path) — the toggle reports unsupported and stays hidden.
class DutyModeNotifier extends Notifier<bool> {
  static const _kKey = 'vexevn.duty_mode_enabled';
  static const _kChannel = MethodChannel('datxevui/duty');
  int _changeVersion = 0;

  @override
  bool build() {
    _restore();
    return false;
  }

  Future<void> _restore() async {
    final versionAtStart = _changeVersion;
    final prefs = await SharedPreferences.getInstance();
    final enabled = prefs.getBool(_kKey) ?? false;
    if (versionAtStart != _changeVersion) return;
    if (enabled && !state) state = enabled;
    // Re-apply to the platform: the service dies on force-stop /
    // reboot, so every app start re-starts it if the agent was on
    // duty. Idempotent when already running.
    if (enabled) {
      await _call('start');
    }
  }

  Future<void> set(bool enabled) async {
    _changeVersion++;
    state = enabled;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kKey, enabled);
    await _call(enabled ? 'start' : 'stop');
  }

  Future<bool?> _call(String method) async {
    if (defaultTargetPlatform != TargetPlatform.android) return null;
    try {
      return await _kChannel.invokeMethod<bool?>(method);
    } on PlatformException catch (e) {
      debugPrint('duty-mode $method failed: ${e.message}');
      return null;
    } on MissingPluginException {
      // Older embedder / non-Android host — duty mode unavailable.
      return null;
    }
  }
}

final dutyModeProvider =
    NotifierProvider<DutyModeNotifier, bool>(DutyModeNotifier.new);

/// Whether the current platform supports duty mode at all (Android
/// with the native service registered). Kept as a FutureProvider so
/// settings UI can hide the toggle where it is meaningless.
final dutyModeSupportedProvider = FutureProvider<bool>((ref) async {
  if (defaultTargetPlatform != TargetPlatform.android) return false;
  try {
    return await const MethodChannel('datxevui/duty')
            .invokeMethod<bool?>('isSupported') ??
        false;
  } on PlatformException {
    return false;
  } on MissingPluginException {
    return false;
  }
});
