import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Theme preference (light / dark / system), persisted.
class ThemeModeNotifier extends Notifier<ThemeMode> {
  static const _kKey = 'vexevn.theme_mode';

  @override
  ThemeMode build() {
    _load();
    return ThemeMode.system;
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_kKey);
    final mode = switch (raw) {
      'light' => ThemeMode.light,
      'dark' => ThemeMode.dark,
      _ => ThemeMode.system,
    };
    if (mode != state) state = mode;
  }

  Future<void> set(ThemeMode mode) async {
    state = mode;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kKey, mode.name);
  }
}

final themeModeProvider =
    NotifierProvider<ThemeModeNotifier, ThemeMode>(ThemeModeNotifier.new);

/// Whether agent alerts (sounds + local notifications) are enabled.
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
