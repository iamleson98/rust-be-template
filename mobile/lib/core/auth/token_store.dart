import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'models.dart';

/// Persists the auth session (access/refresh JWTs + user profile) in the
/// platform keystore / keychain. Tokens never touch SharedPreferences.
///
/// The backend's mobile flow (`X-Client: mobile`) returns the raw token
/// pair in the login/refresh JSON body; [ApiClient] stores them here and
/// attaches them as `Authorization: Bearer <jwt>` (REST) and
/// `?token=<jwt>` (WebSocket upgrades — also accepted by both hubs).
class TokenStore {
  TokenStore([FlutterSecureStorage? storage])
      : _storage = storage ?? const FlutterSecureStorage(
          // v11: AES-GCM keystore encryption is the default; no opts needed.
          aOptions: AndroidOptions(),
        );

  final FlutterSecureStorage _storage;

  static const _kAccess = 'datxevui.access_token';
  static const _kRefresh = 'datxevui.refresh_token';
  static const _kUser = 'datxevui.user';

  SessionUser? _cachedUser;
  String? _cachedAccess;
  String? _cachedRefresh;

  SessionUser? get cachedUser => _cachedUser;
  String? get cachedAccess => _cachedAccess;
  String? get cachedRefresh => _cachedRefresh;

  /// Unix-seconds expiry of the cached access JWT, or `null` when the
  /// token is missing or unparseable.
  ///
  /// The JWT payload is base64url-encoded JSON with a standard `exp`
  /// claim (seconds since epoch) — decoding it needs no crypto and no
  /// server round-trip, which is exactly what a background WebSocket
  /// reconnect loop needs to decide "this token is about to die".
  int? get accessExpiresAt {
    final token = _cachedAccess;
    if (token == null || token.isEmpty) return null;
    final parts = token.split('.');
    if (parts.length != 3) return null;
    try {
      // JWT uses base64url WITHOUT padding; normalize before decoding.
      final normalized = base64Url.normalize(parts[1]);
      final payload = jsonDecode(utf8.decode(base64Url.decode(normalized)));
      if (payload is! Map<String, dynamic>) return null;
      final exp = payload['exp'];
      return exp is int ? exp : null;
    } catch (_) {
      return null;
    }
  }

  /// Whether the access token is expired or expires within the next
  /// 60 seconds (a WS handshake + ICE setup can easily take that long,
  /// so "just barely valid" is treated as stale).
  bool get accessIsStale {
    final exp = accessExpiresAt;
    if (exp == null) return false; // unparseable → let the server decide
    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    return exp - now < 60;
  }

  Future<(SessionUser?, String?, String?)> load() async {
    final access = await _storage.read(key: _kAccess);
    final refresh = await _storage.read(key: _kRefresh);
    final rawUser = await _storage.read(key: _kUser);
    SessionUser? user;
    if (rawUser != null) {
      try {
        user = SessionUser.fromJson(
          jsonDecode(rawUser) as Map<String, dynamic>,
        );
      } catch (_) {
        // Corrupt profile row — tokens remain valid; /auth/me will re-fetch.
      }
    }
    _cachedAccess = access;
    _cachedRefresh = refresh;
    _cachedUser = user;
    return (user, access, refresh);
  }

  Future<void> save({
    required SessionUser user,
    required String accessToken,
    required String refreshToken,
  }) async {
    _cachedUser = user;
    _cachedAccess = accessToken;
    _cachedRefresh = refreshToken;
    await _storage.write(key: _kAccess, value: accessToken);
    await _storage.write(key: _kRefresh, value: refreshToken);
    await _storage.write(key: _kUser, value: jsonEncode(user.toJson()));
  }

  /// Update tokens only (refresh rotation keeps the same user).
  Future<void> saveTokens({
    required String accessToken,
    required String refreshToken,
  }) async {
    _cachedAccess = accessToken;
    _cachedRefresh = refreshToken;
    await _storage.write(key: _kAccess, value: accessToken);
    await _storage.write(key: _kRefresh, value: refreshToken);
  }

  Future<void> clear() async {
    _cachedUser = null;
    _cachedAccess = null;
    _cachedRefresh = null;
    await _storage.delete(key: _kAccess);
    await _storage.delete(key: _kRefresh);
    await _storage.delete(key: _kUser);
  }
}
