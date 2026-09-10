import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

abstract class _BoolPreferenceNotifier extends Notifier<bool> {
  int _changeVersion = 0;

  String get preferenceKey;

  bool get defaultValue => true;

  @override
  bool build() {
    _load();
    return defaultValue;
  }

  Future<void> _load() async {
    final versionAtStart = _changeVersion;
    final prefs = await SharedPreferences.getInstance();
    final enabled = prefs.getBool(preferenceKey);
    if (versionAtStart == _changeVersion &&
        enabled != null &&
        enabled != state) {
      state = enabled;
    }
  }

  Future<void> set(bool enabled) async {
    _changeVersion++;
    state = enabled;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(preferenceKey, enabled);
  }
}

/// Master switch: whether agent alerts fire at all (notifications,
/// sounds, haptics). Individual channels can be tuned below.
class AlertsEnabledNotifier extends _BoolPreferenceNotifier {
  @override
  String get preferenceKey => 'vexevn.alerts_enabled';
}

final alertsEnabledProvider =
    NotifierProvider<AlertsEnabledNotifier, bool>(AlertsEnabledNotifier.new);

/// Whether messenger sounds play (message cues + call ringtone).
/// Real tunes, not synths: see `assets/sounds/ATTRIBUTION.md`.
class SoundEnabledNotifier extends _BoolPreferenceNotifier {
  @override
  String get preferenceKey => 'vexevn.sound_enabled';
}

final soundEnabledProvider =
    NotifierProvider<SoundEnabledNotifier, bool>(SoundEnabledNotifier.new);

/// Whether the device vibrates on incoming messages/calls.
class VibrateEnabledNotifier extends _BoolPreferenceNotifier {
  @override
  String get preferenceKey => 'vexevn.vibrate_enabled';
}

final vibrateEnabledProvider =
    NotifierProvider<VibrateEnabledNotifier, bool>(VibrateEnabledNotifier.new);
