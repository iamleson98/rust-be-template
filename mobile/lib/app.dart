import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:forui/forui.dart';

import 'core/router.dart';
import 'core/theme_mode.dart';
import 'features/call/call_controller.dart';
import 'features/chat/chat_service.dart';
import 'features/call/call_signaling.dart';
import 'features/notifications/notification_service.dart';

/// Root widget: theme plumbing (forui + Material), the call-screen
/// navigation listener, notification tap deep-links, and app-lifecycle
/// driven reconnects.
class VeXevnApp extends ConsumerStatefulWidget {
  const VeXevnApp({super.key});

  @override
  ConsumerState<VeXevnApp> createState() => _VeXevnAppState();
}

class _VeXevnAppState extends ConsumerState<VeXevnApp>
    with WidgetsBindingObserver {
  bool _callRouteOpen = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    Future(() async {
      final notifications = ref.read(notificationServiceProvider);
      await notifications.init();
      notifications.onTap = _onNotificationTap;
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final resumed = state == AppLifecycleState.resumed;
    ref.read(appResumedProvider.notifier).set(resumed);
    if (resumed) {
      // Mobile OSes freeze sockets in the background — reconnect now
      // instead of waiting for the backoff timer.
      ref.read(chatLiveServiceProvider)?.reconnectNow();
      ref.read(callSignalingProvider)?.reconnectNow();
    }
  }

  void _onNotificationTap(Map<String, dynamic> payload) {
    final router = ref.read(routerProvider);
    switch (payload['type'] as String?) {
      case 'chat':
        final channelId = payload['channelId'] as String?;
        if (channelId != null) {
          ref.read(notificationServiceProvider).clearChannel(channelId);
          router.push('/chat/$channelId');
        }
      case 'call':
        router.push('/call');
    }
  }

  @override
  Widget build(BuildContext context) {
    // Keep the alert wiring alive for the app's lifetime.
    ref.watch(agentAlertsProvider);

    final mode = ref.watch(themeModeProvider);
    final dark = switch (mode) {
      ThemeMode.dark => true,
      ThemeMode.light => false,
      // Above MaterialApp there is no MediaQuery yet — ask the platform
      // dispatcher directly.
      ThemeMode.system =>
          WidgetsBinding.instance.platformDispatcher.platformBrightness ==
              Brightness.dark,
    };
    final fTheme =
        dark ? FTheme.neutral.dark.touch : FTheme.neutral.light.touch;

    // Push/pop the call screen as the call state machine demands.
    ref.listen<CallNav>(callNavProvider, (previous, next) {
      final router = ref.read(routerProvider);
      if (next == CallNav.showCall && !_callRouteOpen) {
        _callRouteOpen = true;
        router.push('/call');
      } else if (next == CallNav.dismissCall && _callRouteOpen) {
        _callRouteOpen = false;
        if (router.canPop()) router.pop();
      }
    });

    return MaterialApp.router(
      title: 'VeXeVN Tổng đài',
      debugShowCheckedModeBanner: false,
      themeMode: mode,
      theme: FTheme.neutral.light.touch.toApproximateMaterialTheme(),
      darkTheme: FTheme.neutral.dark.touch.toApproximateMaterialTheme(),
      localizationsDelegates: FLocalizations.localizationsDelegates,
      supportedLocales: FLocalizations.supportedLocales,
      routerConfig: ref.watch(routerProvider),
      builder: (context, child) => FTheme(
        data: fTheme,
        child: FToaster(child: child!),
      ),
    );
  }
}
