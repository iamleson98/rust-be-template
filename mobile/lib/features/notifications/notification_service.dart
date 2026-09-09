import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/audio/sound_service.dart';
import '../../core/settings.dart';
import '../call/call_controller.dart';
import '../call/call_state.dart';
import '../chat/chat_service.dart' show chatLiveServiceProvider;
import '../chat/rooms_controller.dart';

/// Local notifications for the support agent:
///   * new customer message (per-channel id → stacked, auto-cleared on open)
///   * new support request (queue events)
///   * incoming call
///
/// Sounds are real messenger tunes bundled as raw resources (Android) and
/// app-bundle files (iOS) — see `assets/sounds/ATTRIBUTION.md`:
///   * messages channel → AOSP "Pixie Dust" (`message.mp3`)
///   * calls channel    → AOSP Material "Titania" (`ring.mp3`)
///
/// Behaviour (messenger-style):
///   * app in FOREGROUND  → in-app cue via [SoundService] (no banner —
///     the agent is already looking at the console);
///   * app in BACKGROUND → local notification; the channel sound +
///     vibration pattern ring even when the OS has frozen the UI.
///
/// Tapping a notification deep-links to the chat room (or the call
/// screen) via [onTap], installed by `app.dart`.
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

  /// Message double-tap haptic: two short buzzes.
  static final Int64List _kMessageVibration =
      Int64List.fromList([0, 120, 100, 120]);

  /// Call ring vibration: 1s buzz, 0.3s gap, 1s buzz (repeats with the
  /// ringtone loop while the notification is alive).
  static final Int64List _kCallVibration =
      Int64List.fromList([0, 1000, 300, 1000]);

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
      // NOTE: channel sound/vibration are baked in at creation time and
      // are IMMUTABLE afterwards (Android platform rule). The app is
      // pre-release, so re-installs pick these up cleanly.
      await android?.createNotificationChannel(
        AndroidNotificationChannel(
          _kMessagesChannelId,
          _kMessagesChannelName,
          description: 'Khách hàng nhắn tin cần hỗ trợ',
          importance: Importance.high,
          sound: const RawResourceAndroidNotificationSound('message'),
          enableVibration: true,
          vibrationPattern: _kMessageVibration,
          showBadge: true,
        ),
      );
      await android?.createNotificationChannel(
        AndroidNotificationChannel(
          _kCallsChannelId,
          _kCallsChannelName,
          description: 'Khách hàng gọi tới tổng đài hỗ trợ',
          importance: Importance.max,
          sound: const RawResourceAndroidNotificationSound('ring'),
          enableVibration: true,
          vibrationPattern: _kCallVibration,
          showBadge: true,
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
      notificationDetails: NotificationDetails(
        android: AndroidNotificationDetails(
          _kMessagesChannelId,
          _kMessagesChannelName,
          channelDescription: 'Khách hàng nhắn tin cần hỗ trợ',
          importance: Importance.high,
          priority: Priority.high,
          category: AndroidNotificationCategory.message,
          sound: const RawResourceAndroidNotificationSound('message'),
          enableVibration: true,
          vibrationPattern: _kMessageVibration,
        ),
        iOS: const DarwinNotificationDetails(
          sound: 'message.mp3',
          presentSound: true,
        ),
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
      notificationDetails: NotificationDetails(
        android: AndroidNotificationDetails(
          _kMessagesChannelId,
          _kMessagesChannelName,
          channelDescription: 'Khách hàng nhắn tin cần hỗ trợ',
          importance: Importance.max,
          priority: Priority.max,
          sound: const RawResourceAndroidNotificationSound('message'),
          enableVibration: true,
          vibrationPattern: _kMessageVibration,
        ),
        iOS: const DarwinNotificationDetails(
          sound: 'message.mp3',
          presentSound: true,
        ),
      ),
      payload: jsonEncode({'type': 'chat'}),
    );
  }

  Future<void> showIncomingCall({required String callerName}) async {
    if (!_ready) return;
    await _plugin.show(
      id: 1002,
      title: 'Cuộc gọi đến',
      body: callerName,
      notificationDetails: NotificationDetails(
        android: AndroidNotificationDetails(
          _kCallsChannelId,
          _kCallsChannelName,
          channelDescription: 'Khách hàng gọi tới tổng đài hỗ trợ',
          importance: Importance.max,
          priority: Priority.max,
          category: AndroidNotificationCategory.call,
          sound: const RawResourceAndroidNotificationSound('ring'),
          enableVibration: true,
          vibrationPattern: _kCallVibration,
          ongoing: true,
          autoCancel: true,
          // Full-screen intent: the incoming call rings OVER the
          // lockscreen / on top of any app (needs
          // USE_FULL_SCREEN_INTENT, granted by default for
          // call-style channels on most OEMs; Android 14+ asks
          // unless the app is the default dialer — the notification
          // still heads-up-rings when denied).
          fullScreenIntent: true,
        ),
        iOS: const DarwinNotificationDetails(
          sound: 'ring.mp3',
          presentSound: true,
          presentAlert: true,
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

/// Wires server events → alerts (in-app sound/haptic + notifications).
///
/// Rules (messenger behaviour):
///   * FOREGROUND: a customer message in a room the agent is NOT viewing
///     → in-app sound + haptic only (the console is already on screen);
///   * BACKGROUND: same event → local notification (channel sound +
///     vibration play from the OS, no UI needed);
///   * queue events (`channels_changed` / new inbound traffic with no
///     channel row yet) → "new support request" cue/alert;
///   * incoming call → looping ringtone + repeating vibration in ANY
///     state; plus an ongoing notification when backgrounded (in the
///     foreground the call screen itself is pushed immediately).
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
    if (!_ref.read(alertsEnabledProvider)) return;
    switch (msg['type'] as String?) {
      case 'channel_message':
        final channelId = msg['channelId'] as String?;
        if (channelId == null) return;
        // No alert for the room the agent is actively reading.
        if (_ref.read(activeRoomIdProvider) == channelId) return;
        final senderType = (msg['senderType'] ?? 'user') as String;
        final isAgent = senderType == 'employee' || senderType == 'admin';
        if (isAgent) return;

        if (_ref.read(appResumedProvider)) {
          // Foreground: sound + haptic, no banner.
          unawaited(_ref.read(soundServiceProvider).playMessage());
        } else {
          // Backgrounded: banner — the channel's custom tune + vibration
          // ring from the OS side.
          unawaited(
            _ref.read(notificationServiceProvider).showMessage(
                  channelId: channelId,
                  title: (msg['senderName'] as String?) ?? 'Khách hàng',
                  body: (msg['preview'] as String?) ?? 'Tin nhắn mới',
                ),
          );
        }
      case 'channel_created':
        if (_ref.read(appResumedProvider)) {
          unawaited(_ref.read(soundServiceProvider).playRequest());
        } else {
          unawaited(
            _ref.read(notificationServiceProvider).showNewRequest(
                  title: 'Yêu cầu hỗ trợ mới',
                  body: 'Một khách hàng vừa bắt đầu trò chuyện',
                ),
          );
        }
    }
  }

  void _onCallStatus(CallStatus? prev, CallStatus next) {
    final sound = _ref.read(soundServiceProvider);
    if (next == CallStatus.incoming) {
      // Ring + vibrate in any state — messenger-style.
      unawaited(sound.startIncomingRing());
      if (!_ref.read(appResumedProvider)) {
        final name = _ref.read(callUiStateProvider).peerName;
        unawaited(
          _ref.read(notificationServiceProvider).showIncomingCall(
                callerName: name.isEmpty ? 'Khách hàng' : name,
              ),
        );
      }
    } else if (prev == CallStatus.incoming ||
        prev == CallStatus.calling ||
        next == CallStatus.idle) {
      // Answered, declined, or gone — silence the ring.
      unawaited(sound.stopRinging());
      unawaited(_ref.read(notificationServiceProvider).clearCall());
    }
    if (next == CallStatus.ended) {
      unawaited(sound.playCallEnded());
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
