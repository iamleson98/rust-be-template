import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Theme preference (light / dark / system), persisted.
class ThemeModeNotifier extends Notifier<ThemeMode> {
  static const _kKey = 'vexevn.theme_mode';
  int _changeVersion = 0;

  @override
  ThemeMode build() {
    _load();
    return ThemeMode.system;
  }

  Future<void> _load() async {
    final versionAtStart = _changeVersion;
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_kKey);
    final mode = switch (raw) {
      'light' => ThemeMode.light,
      'dark' => ThemeMode.dark,
      _ => ThemeMode.system,
    };
    if (versionAtStart == _changeVersion && mode != state) state = mode;
  }

  Future<void> set(ThemeMode mode) async {
    _changeVersion++;
    state = mode;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kKey, mode.name);
  }
}

final themeModeProvider =
    NotifierProvider<ThemeModeNotifier, ThemeMode>(ThemeModeNotifier.new);
