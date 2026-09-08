import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../env.dart';
import '../net/api_client.dart';
import 'models.dart';
import 'token_store.dart';

/// Global token store.
///
/// Deliberately a plain global behind a provider (instead of a
/// provider-owned instance): Riverpod 3 auto-disposes unused providers,
/// which would recreate [TokenStore] and drop its in-memory token cache
/// that [ApiClient] holds a reference to. The global keeps a single
/// identity for the whole process lifetime.
final globalTokenStore = TokenStore();

final tokenStoreProvider =
    Provider<TokenStore>((ref) => globalTokenStore);

/// The API client. Rebuilt when the configured server URL changes.
final apiClientProvider = Provider<ApiClient>((ref) {
  final cfg = ref.watch(appConfigProvider);
  final api = ApiClient(
    baseUrl: cfg.httpBase,
    tokens: ref.watch(tokenStoreProvider),
    onSessionExpired: () {
      // Refresh failed — the session is gone. Drop local state and let
      // the router redirect to the login screen.
      ref.read(authControllerProvider.notifier).forceLocalLogout();
    },
  );
  return api;
});

class AuthController extends Notifier<AuthState> {
  @override
  AuthState build() {
    _restore();
    return AuthState.empty;
  }

  // Ticket that invalidates an in-flight restore when login/logout happens
  // while the restore is still awaiting the network.
  static var _restoreToken = 0;

  /// Restores a persisted session on cold start: load tokens, validate
  /// with `/auth/me` (the API layer auto-refreshes on 401), then publish.
  /// `restored` flips to true either way so the router can leave the
  /// splash screen for /chat (auto-login) or /login (no session) WITHOUT
  /// flashing the login form during the token check.
  Future<void> _restore() async {
    final ticket = ++_restoreToken;
    final tokens = ref.read(tokenStoreProvider);
    final (user, access, refresh) = await tokens.load();
    if (ticket != _restoreToken) return;
    if (user == null || access == null) {
      state = AuthState.signedOut;
      return;
    }
    state = AuthState(
      user: user,
      accessToken: access,
      refreshToken: refresh,
      restored: true,
    );

    // Validate in the background; a 401 here means the refresh already
    // failed inside the interceptor → log out.
    final api = ref.read(apiClientProvider);
    try {
      final fresh = await api.me();
      if (ticket != _restoreToken) return;
      state = AuthState(
        user: fresh,
        accessToken: access,
        refreshToken: refresh,
        restored: true,
      );
    } on ApiException catch (e) {
      if (ticket != _restoreToken) return;
      if (e.statusCode == 401) {
        await forceLocalLogout();
      }
      // Network errors during validation keep the cached session —
      // the agent stays usable offline-ish; WS will retry anyway.
    } catch (_) {}
  }

  /// Staff login. Returns an error message on failure, null on success.
  Future<String?> login({
    required String email,
    required String password,
  }) async {
    final api = ref.read(apiClientProvider);
    try {
      final user = await api.login(email: email, password: password);
      final tokens = ref.read(tokenStoreProvider);
      state = AuthState(
        user: user,
        accessToken: tokens.cachedAccess,
        refreshToken: tokens.cachedRefresh,
        restored: true,
      );
      return null;
    } on ApiException catch (e) {
      return e.message;
    } on Object catch (e) {
      return 'Không kết nối được máy chủ — kiểm tra địa chỉ và mạng ($e)';
    }
  }

  /// Server-side logout (revokes refresh tokens) + local clear.
  Future<void> logout() async {
    final api = ref.read(apiClientProvider);
    try {
      await api.logout();
    } catch (_) {
      // Server unreachable / already revoked — local clear is enough.
      await ref.read(tokenStoreProvider).clear();
    }
    _reset();
  }

  /// Local-only logout (session expired while offline, config change).
  Future<void> forceLocalLogout() async {
    await ref.read(tokenStoreProvider).clear();
    _reset();
  }

  void _reset() {
    _restoreToken++;
    state = AuthState.signedOut;
  }
}

final authControllerProvider =
    NotifierProvider<AuthController, AuthState>(AuthController.new);
