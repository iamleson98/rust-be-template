import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/design.dart';
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
///
/// Motion design: every route has a deliberate transition —
///   * splash/login → shell: soft fade-through (no directionality);
///   * queue → chat room: iOS-style slide-from-right push;
///   * call: instant (it's an interruption overlay, not a navigation).
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
        pageBuilder: (context, state) => CustomTransitionPage(
          key: state.pageKey,
          child: const SplashScreen(),
          transitionDuration: AppMotion.page,
          transitionsBuilder: _fadeThrough,
        ),
      ),
      GoRoute(
        path: '/login',
        pageBuilder: (context, state) => CustomTransitionPage(
          key: state.pageKey,
          child: const LoginScreen(),
          transitionDuration: AppMotion.page,
          transitionsBuilder: _fadeThrough,
        ),
      ),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => HomeShell(shell: shell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/chat',
                pageBuilder: (context, state) => CustomTransitionPage(
                  key: state.pageKey,
                  child: const ConversationsScreen(),
                  transitionDuration: AppMotion.page,
                  transitionsBuilder: _fadeThrough,
                ),
                routes: [
                  GoRoute(
                    path: ':channelId',
                    // The room covers EVERYTHING (root navigator, above
                    // the floating bottom bar) — messenger-style
                    // immersion; popping returns to the queue.
                    parentNavigatorKey: rootNavigatorKey,
                    pageBuilder: (context, state) => CustomTransitionPage(
                      key: state.pageKey,
                      child: RoomScreen(
                        channelId: state.pathParameters['channelId']!,
                      ),
                      transitionDuration: AppMotion.page,
                      reverseTransitionDuration: AppMotion.page,
                      transitionsBuilder: _slideFromRight,
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
                pageBuilder: (context, state) => CustomTransitionPage(
                  key: state.pageKey,
                  child: const TeamScreen(),
                  transitionDuration: AppMotion.page,
                  transitionsBuilder: _fadeThrough,
                ),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/settings',
                pageBuilder: (context, state) => CustomTransitionPage(
                  key: state.pageKey,
                  child: const SettingsScreen(),
                  transitionDuration: AppMotion.page,
                  transitionsBuilder: _fadeThrough,
                ),
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

/// Fade-through (Material You tab-switch motion): outgoing fades out,
/// incoming fades in with a subtle scale settle.
Widget _fadeThrough(
  BuildContext context,
  Animation<double> animation,
  Animation<double> secondaryAnimation,
  Widget child,
) {
  final curved = CurvedAnimation(
    parent: animation,
    curve: AppMotion.easeOutCubic,
  );
  return FadeTransition(
    opacity: curved,
    child: ScaleTransition(
      scale: Tween(begin: 0.97, end: 1.0).animate(curved),
      child: child,
    ),
  );
}

/// iOS-style horizontal push (queue → room) with a hint of parallax on
/// the page below.
Widget _slideFromRight(
  BuildContext context,
  Animation<double> animation,
  Animation<double> secondaryAnimation,
  Widget child,
) {
  final curved = CurvedAnimation(
    parent: animation,
    curve: AppMotion.easeOutCubic,
    reverseCurve: AppMotion.easeInCubic,
  );
  return SlideTransition(
    position: Tween(
      begin: const Offset(1, 0),
      end: Offset.zero,
    ).animate(curved),
    child: FadeTransition(
      opacity: Tween(begin: 0.4, end: 1.0).animate(curved),
      child: child,
    ),
  );
}
