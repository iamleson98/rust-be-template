import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// App-level configuration.
///
/// The agent console points at a specific backend deployment. The URL is
/// supplied (in priority order):
///   1. `--dart-define=API_BASE_URL=https://api.example.com` (CI / enterprise)
///   2. a value the agent saved on the login screen (persisted locally)
///   3. a dev default — `http://10.0.2.2:8080`, which is the Android
///      emulator's alias for the host machine's `localhost:8080`.
@immutable
class AppConfig {
  const AppConfig({required this.baseUrl});

  /// Scheme + host + optional port, e.g. `https://api.datxevui.com`.
  final String baseUrl;

  /// Base URL without a trailing slash, safe for path concatenation.
  String get httpBase {
    final b = baseUrl.trim();
    return b.endsWith('/') ? b.substring(0, b.length - 1) : b;
  }

  /// Builds a WebSocket URI from the base URL: `http(s)://` → `ws(s)://`.
  Uri wsUri(String path, [Map<String, String>? query]) {
    final base = Uri.parse(httpBase);
    return base.replace(
      scheme: base.scheme == 'https' ? 'wss' : 'ws',
      path: _joinPath(base.path, path),
      queryParameters: query,
    );
  }

  static String _joinPath(String basePath, String path) {
    final baseSegments =
        basePath.split('/').where((s) => s.isNotEmpty).toList();
    final segments = path
        .split('/')
        .where((s) => s.isNotEmpty)
        .toList();
    return '/${[...baseSegments, ...segments].join('/')}';
  }

  AppConfig copyWith({String? baseUrl}) =>
      AppConfig(baseUrl: baseUrl ?? this.baseUrl);
}

const _kServerUrlKey = 'vexevn.server_url';

/// Compile-time override, else null.
const _kDartDefineUrl = String.fromEnvironment('API_BASE_URL');

/// Dev default: Android emulator host loopback. iOS simulator would use
/// `http://localhost:8080` — agents set the real URL on first launch anyway.
const _kDefaultUrl = 'http://10.0.2.2:8080';

class AppConfigNotifier extends Notifier<AppConfig> {
  @override
  AppConfig build() {
    _load();
    if (_kDartDefineUrl.isNotEmpty) {
      return AppConfig(baseUrl: _kDartDefineUrl);
    }
    return const AppConfig(baseUrl: _kDefaultUrl);
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_kServerUrlKey);
    if (saved != null && saved.isNotEmpty && _kDartDefineUrl.isEmpty) {
      if (saved != state.baseUrl) state = AppConfig(baseUrl: saved);
    }
  }

  Future<void> setServerUrl(String url) async {
    state = AppConfig(baseUrl: url);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kServerUrlKey, url);
  }
}

final appConfigProvider =
    NotifierProvider<AppConfigNotifier, AppConfig>(AppConfigNotifier.new);
