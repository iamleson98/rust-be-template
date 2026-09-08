import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Master switch: whether agent alerts fire at all (notifications,
/// sounds, haptics). Individual channels can be tuned below.
class AlertsEnabledNotifier extends Notifier<bool> {
  static const _kKey = 'vexevn.alerts_enabled';

  @override
  bool build() {
    _load();
    return true;
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final enabled = prefs.getBool(_kKey);
    if (enabled != null && enabled != state) state = enabled;
  }

  Future<void> set(bool enabled) async {
    state = enabled;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kKey, enabled);
  }
}

final alertsEnabledProvider =
    NotifierProvider<AlertsEnabledNotifier, bool>(AlertsEnabledNotifier.new);

/// Whether messenger sounds play (message cues + call ringtone).
/// Real tunes, not synths: see `assets/sounds/ATTRIBUTION.md`.
class SoundEnabledNotifier extends Notifier<bool> {
  static const _kKey = 'vexevn.sound_enabled';

  @override
  bool build() {
    _load();
    return true;
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final enabled = prefs.getBool(_kKey);
    if (enabled != null && enabled != state) state = enabled;
  }

  Future<void> set(bool enabled) async {
    state = enabled;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kKey, enabled);
  }
}

final soundEnabledProvider =
    NotifierProvider<SoundEnabledNotifier, bool>(SoundEnabledNotifier.new);

/// Whether the device vibrates on incoming messages/calls.
class VibrateEnabledNotifier extends Notifier<bool> {
  static const _kKey = 'vexevn.vibrate_enabled';

  @override
  bool build() {
    _load();
    return true;
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final enabled = prefs.getBool(_kKey);
    if (enabled != null && enabled != state) state = enabled;
  }

  Future<void> set(bool enabled) async {
    state = enabled;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kKey, enabled);
  }
}

final vibrateEnabledProvider =
    NotifierProvider<VibrateEnabledNotifier, bool>(VibrateEnabledNotifier.new);
