import 'package:dio/dio.dart';

import '../auth/models.dart';
import '../auth/token_store.dart';

/// Thin typed wrapper over the backend REST API.
///
/// ## Auth model (mobile Bearer flow)
///
/// The backend authenticates REST calls with the `access_token` cookie for
/// browsers; the mobile app instead opts into the raw-token flow:
///
///   * login/refresh requests carry `X-Client: mobile`, so the response
///     JSON includes `tokens.accessToken` / `tokens.refreshToken` (backend
///     change — see `src/routes/auth.rs`); they are stored in [TokenStore];
///   * every request sends `Authorization: Bearer <access>` (the REST
///     extractors accept the header — see `src/middleware/auth_extractor.rs`);
///   * a 401 triggers a **single-flight** `POST /api/auth/refresh`
///     (refresh token in the JSON body — explicitly supported for
///     non-browser clients) and retries the original request once;
///   * a failed refresh fires [onSessionExpired] so the auth controller
///     can log the agent out.
class ApiClient {
  ApiClient({
    required String baseUrl,
    required this.tokens,
    this.onSessionExpired,
  }) : dio = Dio(
          BaseOptions(
            baseUrl: baseUrl,
            connectTimeout: const Duration(seconds: 10),
            receiveTimeout: const Duration(seconds: 30),
            headers: {
              'Accept': 'application/json',
              'X-Client': 'mobile',
            },
            validateStatus: (code) => code != null && code < 500,
          ),
        ) {
    dio.interceptors.add(
      InterceptorsWrapper(onRequest: _attachAuth, onResponse: _onResponse),
    );
  }

  final Dio dio;
  final TokenStore tokens;
  void Function()? onSessionExpired;

  /// Guards against parallel refreshes: while set, other 401s await the
  /// in-flight rotation instead of firing their own.
  Future<bool>? _refreshing;

  // ── Interceptors ───────────────────────────────────────────────────
  //
  // NOTE: `validateStatus` resolves all < 500 responses, so 401s arrive
  // as successful `Response` objects — the auth refresh therefore lives
  // in onResponse (NOT onError).

  void _attachAuth(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) {
    if (options.extra['skipAuth'] != true) {
      final token = tokens.cachedAccess;
      if (token != null && token.isNotEmpty) {
        options.headers['Authorization'] = 'Bearer $token';
      }
    }
    handler.next(options);
  }

  Future<void> _onResponse(
    Response<dynamic> res,
    ResponseInterceptorHandler handler,
  ) async {
    final opts = res.requestOptions;
    final isAuthCall = opts.path.contains('/api/auth/');
    final alreadyRetried = opts.extra['retried'] == true;

    if (res.statusCode != 401 ||
        opts.extra['skipAuth'] == true ||
        isAuthCall ||
        alreadyRetried) {
      return handler.next(res);
    }

    final refreshed = await _refreshTokens();
    if (!refreshed) {
      onSessionExpired?.call();
      return handler.next(res); // surface the 401 to the caller
    }

    // Retry the original request once, with the fresh token.
    opts.extra['retried'] = true;
    try {
      opts.headers['Authorization'] =
          'Bearer ${tokens.cachedAccess ?? ''}';
      final retry = await dio.fetch(opts);
      return handler.resolve(retry);
    } on DioException catch (e) {
      // 5xx/connection failure on retry — hand back whatever we have.
      return handler.resolve(e.response ?? res);
    }
  }

  Future<bool> _refreshTokens() {
    // Single-flight: concurrent 401s share one rotation.
    return _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);
  }

  Future<bool> _doRefresh() async {
    final refresh = tokens.cachedRefresh;
    if (refresh == null || refresh.isEmpty) return false;
    try {
      final res = await dio.post(
        '/api/auth/refresh',
        data: {'refresh_token': refresh},
        options: Options(extra: {'skipAuth': true}),
      );
      if (res.statusCode != 200) return false;
      final rawTokens = res.data['tokens'];
      if (rawTokens is! Map) return false;
      final newAccess = rawTokens['access_token'];
      final newRefresh = rawTokens['refresh_token'];
      if (newAccess is! String || newRefresh is! String) return false;
      await tokens.saveTokens(
        accessToken: newAccess,
        refreshToken: newRefresh,
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  // ── Auth ───────────────────────────────────────────────────────────

  /// `POST /api/auth/employee-login` — staff-only login. With
  /// `X-Client: mobile` the response embeds the raw token pair.
  Future<SessionUser> login({
    required String email,
    required String password,
  }) async {
    final res = await dio.post(
      '/api/auth/employee-login',
      data: {'email': email, 'password': password},
      options: Options(extra: {'skipAuth': true}),
    );
    _throwIfNotOk(res, 200, 'Đăng nhập thất bại');
    final rawTokens = res.data['tokens'];
    if (rawTokens is! Map ||
        rawTokens['access_token'] is! String ||
        rawTokens['refresh_token'] is! String) {
      throw const ApiException('Phiên đăng nhập không hợp lệ (thiếu token)');
    }
    final user = SessionUser.fromJson(res.data['user'] as Map<String, dynamic>);
    await tokens.save(
      user: user,
      accessToken: rawTokens['access_token'] as String,
      refreshToken: rawTokens['refresh_token'] as String,
    );
    return user;
  }

  /// `GET /api/auth/me` — validates the access token and returns the user.
  Future<SessionUser> me() async {
    final res = await dio.get('/api/auth/me');
    _throwIfNotOk(res, 200, 'Không xác thực được phiên');
    return SessionUser.fromJson(res.data['user'] as Map<String, dynamic>);
  }

  /// `POST /api/auth/logout` — revokes refresh tokens server-side.
  Future<void> logout() async {
    try {
      await dio.post('/api/auth/logout');
    } finally {
      await tokens.clear();
    }
  }

  // ── Chat ───────────────────────────────────────────────────────────

  /// `GET /api/chat/channels` — the support queue (newest activity first).
  Future<List<Map<String, dynamic>>> listChannels({int limit = 200}) async =>
      _items(await dio.get(
        '/api/chat/channels',
        queryParameters: {'limit': limit},
      ));

  /// `GET /api/chat/channels/{id}/messages` — newest-first; reverse for
  /// chronological display. Paginated (`limit`/`offset`) so the room can
  /// lazily load older pages while the user scrolls up.
  Future<List<Map<String, dynamic>>> listMessages(
    String channelId, {
    int limit = 30,
    int offset = 0,
  }) async =>
      _items(await dio.get(
        '/api/chat/channels/$channelId/messages',
        queryParameters: {'limit': limit, 'offset': offset},
      ));

  /// `POST /api/chat/channels/{id}/messages` — REST send (WS is receive-only
  /// for the agent console; the response is authoritative).
  Future<Map<String, dynamic>> sendMessage(
    String channelId, {
    required String content,
    required String clientMsgId,
  }) async {
    final res = await dio.post(
      '/api/chat/channels/$channelId/messages',
      data: {
        'content': content,
        'kind': 'text',
        'clientMsgId': clientMsgId,
      },
    );
    _throwIfNotOk(res, 201, 'Không gửi được tin nhắn');
    return res.data['message'] as Map<String, dynamic>;
  }

  /// `POST /api/chat/channels/{id}/read`
  Future<void> markRead(String channelId) async {
    await dio.post('/api/chat/channels/$channelId/read');
  }

  /// `POST /api/chat/channels/{id}/claim|release|close`
  Future<Map<String, dynamic>> channelAction(
    String channelId,
    String action, // claim | release | close
  ) async {
    final res = await dio.post('/api/chat/channels/$channelId/$action');
    _throwIfNotOk(res, 200, 'Thao tác thất bại');
    return res.data['channel'] as Map<String, dynamic>;
  }

  /// `GET /api/presence/staff` — team availability snapshot.
  Future<Map<String, dynamic>> staffPresence() async {
    final res = await dio.get('/api/presence/staff');
    _throwIfNotOk(res, 200, 'Không tải được trạng thái nhân viên');
    return res.data as Map<String, dynamic>;
  }

  // ── Health ─────────────────────────────────────────────────────────

  /// Cheap reachability probe used by the login screen (`/health` is
  /// mounted at the root, outside the `/api` nest).
  Future<bool> ping() async {
    try {
      final res = await dio.get(
        '/health',
        options: Options(extra: {'skipAuth': true}),
      );
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────

  List<Map<String, dynamic>> _items(Response<dynamic> res) {
    _throwIfNotOk(res, 200, 'Không tải được dữ liệu');
    final items = res.data['items'];
    return (items as List? ?? [])
        .whereType<Map<String, dynamic>>()
        .map((e) => e)
        .toList();
  }

  void _throwIfNotOk(Response<dynamic> res, int expected, String fallback) {
    if (res.statusCode == expected) return;
    throw ApiException(_extractMessage(res) ?? fallback, res.statusCode);
  }

  static String? _extractMessage(Response<dynamic> res) {
    final data = res.data;
    if (data is Map) {
      final direct = data['message'];
      if (direct is String && direct.isNotEmpty) return direct;
      final nested = data['error'];
      if (nested is String) return nested;
      if (nested is Map && nested['message'] is String) {
        return nested['message'] as String;
      }
    }
    return null;
  }
}

class ApiException implements Exception {
  const ApiException(this.message, [this.statusCode]);

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}
