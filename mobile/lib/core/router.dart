import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/chat/conversations_screen.dart';
import '../features/chat/room_screen.dart';
import '../features/login/login_screen.dart';
import '../features/call/call_screen.dart';
import '../features/settings/settings_screen.dart';
import '../features/splash/splash_screen.dart';
import '../features/team/team_screen.dart';
import '../shared/home_shell.dart';
import 'auth/auth_controller.dart';

final rootNavigatorKey = GlobalKey<NavigatorState>();

/// App navigation.
///
/// `/splash` (cold start, while the persisted session restores) →
/// `/login` or the post-login shell — so auto-login never flashes the
/// login form. The shell has three bottom-nav branches (queue / team /
/// settings) with the chat room nested in the queue branch; `/call`
/// renders ABOVE the shell on the root navigator so it covers
/// everything (it's pushed/popped by the call-state listener in
/// `app.dart`, not by hand).
final routerProvider = Provider<GoRouter>((ref) {
  // Re-evaluate the redirect whenever auth flips. Riverpod 3: Ref.listen
  // (auto-tied to this provider's lifetime — no manual disposal needed).
  final loggedIn =
      ValueNotifier<bool>(ref.read(authControllerProvider).isLoggedIn);
  ref.listen<bool>(
    authControllerProvider.select((s) => s.isLoggedIn),
    (_, next) => loggedIn.value = next,
  );
  // Session restore finishing (with no session) must also re-run the
  // redirect: loggedIn stays false, but the splash must give way to
  // the login screen.
  final restoreTick = ValueNotifier<int>(0);
  ref.listen<bool>(
    authControllerProvider.select((s) => s.restored),
    (_, next) {
      loggedIn.value = ref.read(authControllerProvider).isLoggedIn;
      restoreTick.value++;
    },
  );
  ref.onDispose(() {
    loggedIn.dispose();
    restoreTick.dispose();
  });

  return GoRouter(
    navigatorKey: rootNavigatorKey,
    initialLocation: '/splash',
    refreshListenable: Listenable.merge([loggedIn, restoreTick]),
    redirect: (context, state) {
      final auth = ref.read(authControllerProvider);
      final ok = auth.isLoggedIn;
      final atSplash = state.matchedLocation == '/splash';
      final atLogin = state.matchedLocation == '/login';
      // Still restoring a persisted session — hold on the splash.
      if (!auth.restored && !ok) return atSplash ? null : '/splash';
      // Session known (restored or fresh login) — enter the console.
      if (ok && (atLogin || atSplash)) return '/chat';
      // Restore finished without a session — show the login form.
      if (!ok && (atSplash || !atLogin)) return '/login';
      return null;
    },
    routes: [
      GoRoute(
        path: '/splash',
        builder: (context, state) => const SplashScreen(),
      ),
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => HomeShell(shell: shell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/chat',
                builder: (context, state) => const ConversationsScreen(),
                routes: [
                  GoRoute(
                    path: ':channelId',
                    builder: (context, state) => RoomScreen(
                      channelId: state.pathParameters['channelId']!,
                    ),
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/team',
                builder: (context, state) => const TeamScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/settings',
                builder: (context, state) => const SettingsScreen(),
              ),
            ],
          ),
        ],
      ),
      GoRoute(
        path: '/call',
        parentNavigatorKey: rootNavigatorKey,
        pageBuilder: (context, state) => const NoTransitionPage(
          child: CallScreen(),
        ),
      ),
    ],
  );
});
