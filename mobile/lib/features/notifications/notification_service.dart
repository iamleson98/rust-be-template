import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../call/call_controller.dart';
import '../call/call_state.dart';
import '../chat/chat_service.dart' show chatLiveServiceProvider;
import '../chat/rooms_controller.dart';

/// Local notifications for the support agent:
///   * new customer message (per-channel id → stacked, auto-cleared on open)
///   * new support request (queue events)
///   * incoming call
///
/// Tapping a notification deep-links to the chat room (or the call screen)
/// via [onTap], installed by `app.dart`.
///
/// Background push (FCM/APNs) is the documented upgrade path — see the
/// project README ("Push notifications") for the `flutterfire configure`
/// steps; the payloads and routes are already in place here.
class NotificationService {
  final FlutterLocalNotificationsPlugin _plugin =
      FlutterLocalNotificationsPlugin();

  static const _kMessagesChannelId = 'vexevn_messages';
  static const _kMessagesChannelName = 'Tin nhắn khách hàng';
  static const _kCallsChannelId = 'vexevn_calls';
  static const _kCallsChannelName = 'Cuộc gọi đến';

  void Function(Map<String, dynamic> payload)? onTap;

  bool _ready = false;

  Future<void> init() async {
    if (_ready) return;
    try {
      await _plugin.initialize(
        settings: const InitializationSettings(
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
          iOS: DarwinInitializationSettings(),
        ),
        onDidReceiveNotificationResponse: _handleTap,
      );
      final android = _plugin.resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin>();
      await android?.createNotificationChannel(
        const AndroidNotificationChannel(
          _kMessagesChannelId,
          _kMessagesChannelName,
          description: 'Khách hàng nhắn tin cần hỗ trợ',
          importance: Importance.high,
        ),
      );
      await android?.createNotificationChannel(
        const AndroidNotificationChannel(
          _kCallsChannelId,
          _kCallsChannelName,
          description: 'Khách hàng gọi tới tổng đài hỗ trợ',
          importance: Importance.max,
        ),
      );
      await android?.requestNotificationsPermission();
      _ready = true;
    } catch (e) {
      debugPrint('[notifications] init failed: $e');
    }
  }

  void _handleTap(NotificationResponse response) {
    final raw = response.payload;
    if (raw == null || onTap == null) return;
    try {
      onTap!(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {}
  }

  Future<void> showMessage({
    required String channelId,
    required String title,
    required String body,
  }) async {
    if (!_ready) return;
    await _plugin.show(
      id: channelId.hashCode & 0x7fffffff,
      title: title,
      body: body,
      notificationDetails: const NotificationDetails(
        android: AndroidNotificationDetails(
          _kMessagesChannelId,
          _kMessagesChannelName,
          channelDescription: 'Khách hàng nhắn tin cần hỗ trợ',
          importance: Importance.high,
          priority: Priority.high,
          category: AndroidNotificationCategory.message,
        ),
        iOS: DarwinNotificationDetails(),
      ),
      payload: jsonEncode({'type': 'chat', 'channelId': channelId}),
    );
  }

  Future<void> showNewRequest({
    required String title,
    required String body,
  }) async {
    if (!_ready) return;
    await _plugin.show(
      id: 1001,
      title: title,
      body: body,
      notificationDetails: const NotificationDetails(
        android: AndroidNotificationDetails(
          _kMessagesChannelId,
          _kMessagesChannelName,
          channelDescription: 'Khách hàng nhắn tin cần hỗ trợ',
          importance: Importance.max,
          priority: Priority.max,
        ),
        iOS: DarwinNotificationDetails(),
      ),
      payload: null,
    );
  }

  Future<void> showIncomingCall({required String callerName}) async {
    if (!_ready) return;
    await _plugin.show(
      id: 1002,
      title: 'Cuộc gọi đến',
      body: callerName,
      notificationDetails: const NotificationDetails(
        android: AndroidNotificationDetails(
          _kCallsChannelId,
          _kCallsChannelName,
          channelDescription: 'Khách hàng gọi tới tổng đài hỗ trợ',
          importance: Importance.max,
          priority: Priority.max,
          category: AndroidNotificationCategory.call,
          ongoing: true,
          autoCancel: true,
        ),
        iOS: DarwinNotificationDetails(
          presentAlert: true,
          presentSound: true,
        ),
      ),
      payload: jsonEncode({'type': 'call'}),
    );
  }

  /// Clear a channel's notification once the agent opens that room.
  Future<void> clearChannel(String channelId) async {
    if (!_ready) return;
    try {
      await _plugin.cancel(id: channelId.hashCode & 0x7fffffff);
    } catch (_) {}
  }

  Future<void> clearCall() async {
    if (!_ready) return;
    try {
      await _plugin.cancel(id: 1002);
    } catch (_) {}
  }
}

/// App lifecycle, tracked by the root widget's observer.
class AppResumedNotifier extends Notifier<bool> {
  @override
  bool build() => true;

  void set(bool resumed) => state = resumed;
}

final appResumedProvider =
    NotifierProvider<AppResumedNotifier, bool>(AppResumedNotifier.new);

final notificationServiceProvider =
    Provider<NotificationService>((ref) => NotificationService());

/// Wires server events → local notifications.
///
/// Rules:
///   * `channel_message` from a customer in a room the agent is NOT
///     viewing → notify + sound;
///   * queue-shape events (`channels_changed` / new inbound traffic with
///     no channel row yet) → "new support request" alert;
///   * an incoming call while the app is backgrounded → call notification
///     (in the foreground the call screen itself is pushed immediately).
class AgentAlerts {
  AgentAlerts(this._ref) {
    final svc = _ref.read(chatLiveServiceProvider);
    if (svc != null) {
      _sub = svc.events.listen(_onChatEvent, onError: (_) {});
    }
    // Riverpod 3: Ref.listen — tied to this provider's lifetime.
    _ref.listen<CallStatus>(
      callUiStateProvider.select((s) => s.status),
      (prev, next) => _onCallStatus(prev, next),
    );
  }

  final Ref _ref;
  StreamSubscription<Map<String, dynamic>>? _sub;

  void _onChatEvent(Map<String, dynamic> msg) {
    switch (msg['type'] as String?) {
      case 'channel_message':
        final channelId = msg['channelId'] as String?;
        if (channelId == null) return;
        // No alert for the room the agent is actively reading.
        if (_ref.read(activeRoomIdProvider) == channelId) return;
        final senderType = (msg['senderType'] ?? 'user') as String;
        final isAgent = senderType == 'employee' || senderType == 'admin';
        if (isAgent) return;
        unawaited(
          _ref.read(notificationServiceProvider).showMessage(
                channelId: channelId,
                title: (msg['senderName'] as String?) ?? 'Khách hàng',
                body: (msg['preview'] as String?) ?? 'Tin nhắn mới',
              ),
        );
      case 'channel_created':
        unawaited(
          _ref.read(notificationServiceProvider).showNewRequest(
                title: 'Yêu cầu hỗ trợ mới',
                body: 'Một khách hàng vừa bắt đầu trò chuyện',
              ),
        );
    }
  }

  void _onCallStatus(CallStatus? prev, CallStatus next) {
    if (next == CallStatus.incoming && !_ref.read(appResumedProvider)) {
      final name = _ref.read(callUiStateProvider).peerName;
      unawaited(
        _ref.read(notificationServiceProvider).showIncomingCall(
              callerName: name.isEmpty ? 'Khách hàng' : name,
            ),
      );
    } else if (prev == CallStatus.incoming || next == CallStatus.idle) {
      unawaited(_ref.read(notificationServiceProvider).clearCall());
    }
  }

  void dispose() => _sub?.cancel();
}

/// Created once the app shell is up (`app.dart` installs it).
final agentAlertsProvider = Provider<AgentAlerts>((ref) {
  final alerts = AgentAlerts(ref);
  ref.onDispose(alerts.dispose);
  return alerts;
});
