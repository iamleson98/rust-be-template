import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';
import 'package:flutter_callkit_incoming/entities/entities.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import 'call_controller.dart';
import 'call_state.dart';

/// iOS-native incoming-call integration (PushKit VoIP + CallKit).
///
/// Android is deliberately untouched: the in-app call screen + duty-mode
/// foreground service + FCM full-screen notifications already cover it,
/// and the plugin stays dormant when none of its APIs are called.
///
/// ## The production flow this enables (see docs/IOS_CALLS.md)
///
/// 1. The agent's phone is suspended (iOS freezes the process seconds
///    after backgrounding — the /ws-call socket dies with it).
/// 2. A customer calls. The backend's APNs VoIP push (caller name,
///    avatar, ring window) wakes the app; AppDelegate reports it to
///    CallKit → the NATIVE incoming-call screen rings with the caller's
///    identity.
/// 3. The signaling socket reconnects and re-registers; the server
///    re-delivers the missed `incoming` offer on the fresh socket.
/// 4. The agent taps Accept on the CallKit UI → this service bridges
///    the native action into the shared [CallController]; when the
///    re-delivered offer has already arrived the call is accepted
///    immediately, otherwise the accept is applied the moment it lands.
///
/// ## Reconcile rule
///
/// Whenever the shared call state leaves a live-call state, any
/// leftover native CallKit ring is ended (`endAllCalls`) — answered
/// elsewhere, declined, hung up, or timed out server-side all collapse
/// into the same cleanup.
class CallKitService {
  CallKitService(this._ref) {
    _events = FlutterCallkitIncoming.onEvent.listen(_onEvent, onError: (_) {});
    // Provider-scoped listeners (Riverpod 3 ties `Ref.listen`
    // subscriptions to the owning provider's lifetime — same pattern
    // as AgentAlerts; no manual cancel needed).
    //
    // 1. Auto-accept/decline bridge: the native UI's decision is
    //    applied to the shared call state the moment the (re-delivered)
    //    offer arrives.
    _ref.listen<CallStatus>(
      callUiStateProvider.select((s) => s.status),
      (prev, next) => _onCallStatus(prev, next),
    );
    // 2. Logout hygiene: a signed-out phone must stop being rung.
    _ref.listen<bool>(authControllerProvider.select((s) => s.isLoggedIn), (
      prev,
      next,
    ) {
      if (prev == true && next == false) _onSignedOut();
    });
  }

  final Ref _ref;
  StreamSubscription<CallEvent?>? _events;

  /// The agent accepted on the NATIVE CallKit UI before the (re-
  /// delivered) WS offer arrived — apply it the moment the offer lands.
  bool _acceptWhenOfferArrives = false;

  /// Symmetric decline flag — declined on the native UI while the app
  /// was still waiting for the offer: auto-decline so the customer
  /// learns immediately instead of ringing into a void.
  bool _declineWhenOfferArrives = false;

  void dispose() {
    unawaited(_events?.cancel());
    _events = null;
  }

  /// Whether the platform uses this service at all.
  static bool get isActivePlatform => !kIsWeb && Platform.isIOS;

  // ── Device push token ───────────────────────────────────────────────

  /// Fetch the PushKit VoIP token and register it with the backend so
  /// APNs wake-ups reach this phone ("ring even when closed").
  /// Idempotent — safe on every app start; called once the agent is
  /// logged in (the route is authenticated).
  Future<void> registerDeviceToken() async {
    if (!isActivePlatform) return;
    try {
      final token = await FlutterCallkitIncoming.getDevicePushTokenVoIP();
      if (token == null || token.isEmpty) return;
      await _register(token);
    } catch (e) {
      // Push is an accelerator, never a prerequisite — foreground rings
      // still work over the WS. Surfaced for diagnosis only.
      debugPrint('[callkit] voip token registration failed: $e');
    }
  }

  Future<void> _register(String token) async {
    _registeredToken = token;
    await _ref
        .read(apiClientProvider)
        .registerPushDevice(token: token, platform: 'ios');
  }

  /// The VoIP token currently registered with the backend.
  String? _registeredToken;

  Future<void> _onSignedOut() async {
    _acceptWhenOfferArrives = false;
    _declineWhenOfferArrives = false;
    final token = _registeredToken;
    _registeredToken = null;
    if (token != null && token.isNotEmpty) {
      await _ref.read(apiClientProvider).unregisterPushDevice(token);
    }
    await FlutterCallkitIncoming.endAllCalls();
  }

  // ── Native UI events → shared call state ────────────────────────────

  Future<void> _onEvent(CallEvent? event) async {
    switch (event) {
      // PushKit rotated the VoIP token (OS update, reinstall) — the
      // event carries no payload by design; re-fetch and re-register.
      case CallEventActionDidUpdateDevicePushTokenVoip():
        await registerDeviceToken();
      // Accepting on the native UI: the app is now foregrounded, the
      // WS is (re)connecting. If the offer already landed (app was
      // backgrounded-but-alive), accept right away; otherwise arm the
      // bridge — the re-delivered offer fires `_onCallStatus`.
      case CallEventActionCallAccept():
        final notifier = _ref.read(callUiStateProvider.notifier);
        if (_ref.read(callUiStateProvider).status == CallStatus.incoming) {
          await notifier.accept();
        } else {
          _acceptWhenOfferArrives = true;
          _declineWhenOfferArrives = false;
        }
      case CallEventActionCallDecline():
        final notifier = _ref.read(callUiStateProvider.notifier);
        if (_ref.read(callUiStateProvider).status == CallStatus.incoming) {
          notifier.decline();
        } else {
          _declineWhenOfferArrives = true;
          _acceptWhenOfferArrives = false;
        }
      // The native ring ended (user pressed end / nobody answered in
      // the server's ring window). Sync the shared state down.
      case CallEventActionCallConnected():
      case CallEventActionCallEnded():
      case CallEventActionCallTimeout():
        final status = _ref.read(callUiStateProvider).status;
        if (status == CallStatus.incoming || status == CallStatus.calling) {
          _ref.read(callUiStateProvider.notifier).hangup();
        }
      // The in-app call screen owns these states; the native UI is
      // only the background wake-up path.
      case CallEventActionCallIncoming():
      case CallEventActionCallStart():
      case CallEventActionCallCallback():
      case CallEventActionCallCustom():
      case CallEventActionCallToggleHold():
      case CallEventActionCallToggleMute():
      case CallEventActionCallToggleDmtf():
      case CallEventActionCallToggleGroup():
      case CallEventActionCallToggleAudioSession():
        break;
      case null:
        break;
    }
  }

  /// Shared call state transitions → native UI reconciliation.
  void _onCallStatus(CallStatus? prev, CallStatus next) {
    if (next == CallStatus.incoming) {
      // The (re-delivered) offer just landed. Apply a decision the
      // agent already made on the native CallKit UI, if any — the
      // accept path must not re-ring a phone the agent already picked
      // up.
      if (_acceptWhenOfferArrives) {
        _acceptWhenOfferArrives = false;
        unawaited(_ref.read(callUiStateProvider.notifier).accept());
      } else if (_declineWhenOfferArrives) {
        _declineWhenOfferArrives = false;
        _ref.read(callUiStateProvider.notifier).decline();
      }
      return;
    }
    // Any exit from a live call ends leftover native rings — answered
    // elsewhere, declined, hung up, timed out server-side: one cleanup
    // path for all of them.
    final wasLive =
        prev == CallStatus.incoming ||
        prev == CallStatus.calling ||
        prev == CallStatus.connecting ||
        prev == CallStatus.active;
    if (wasLive && (next == CallStatus.idle || next == CallStatus.ended)) {
      if (isActivePlatform) {
        unawaited(FlutterCallkitIncoming.endAllCalls());
      }
      _acceptWhenOfferArrives = false;
      _declineWhenOfferArrives = false;
    }
  }
}

/// The app-lifetime CallKit bridge — `null` everywhere but iOS.
///
/// Constructed by `app.dart` as soon as the shell is up; it watches the
/// auth session itself (registers the VoIP token after login, clears it
/// on logout) so no screen has to remember to.
final callKitServiceProvider = Provider<CallKitService?>((ref) {
  if (!CallKitService.isActivePlatform) return null;
  final service = CallKitService(ref);
  ref.onDispose(service.dispose);
  // Register whenever a session becomes (or is) available — app start
  // (auto-login) and fresh logins both land here.
  ref.listen<bool>(authControllerProvider.select((s) => s.isLoggedIn), (
    _,
    next,
  ) {
    if (next) unawaited(service.registerDeviceToken());
  }, fireImmediately: true);
  return service;
});
