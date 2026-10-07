import 'dart:async' show unawaited;

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'settings.dart';

/// Messenger-grade touch feedback: the tiny haptic ticks that make a
/// chat app feel physical — a light tap when a message leaves, a
/// heavier knock when something fails, a soft select on jump-to-bottom.
///
/// Respects BOTH user settings ([alertsEnabledProvider] master switch
/// and [vibrateEnabledProvider]) plus the OS-level haptics toggle
/// (Flutter's [HapticFeedback] APIs are no-ops when the system
/// disables vibration) — so this never needs its own settings row.
///
/// Usage: fire-and-forget `ref.read(hapticsProvider).messageSent()` —
/// never await, never let it throw (a failed haptic must not break a
/// send). All methods are therefore synchronous best-effort.
class Haptics {
  Haptics(this._ref);

  final Ref _ref;

  bool get _enabled =>
      _ref.read(alertsEnabledProvider) && _ref.read(vibrateEnabledProvider);

  /// Fire a best-effort impact. `catchError` (not try/catch — the
  /// error surfaces on the returned future) keeps an absent platform
  /// channel (widget tests) from failing anything, and `unawaited`
  /// satisfies the repo's `unawaited_futures` lint.
  void _fire(Future<void> impact) {
    unawaited(impact.catchError((_) {}));
  }

  /// A message left the composer — the lightest tick (Messenger's
  /// send feels like a single soft click).
  void messageSent() {
    if (_enabled) _fire(HapticFeedback.lightImpact());
  }

  /// Send failed / call failed — a heavier double-knock so the agent
  /// notices without looking.
  void error() {
    if (_enabled) _fire(HapticFeedback.heavyImpact());
  }

  /// Call placed / call connected — a medium confirm buzz.
  void call() {
    if (_enabled) _fire(HapticFeedback.mediumImpact());
  }

  /// Lightweight selection tick — jump-to-bottom pill, edge-swipe
  /// back, pill taps. Cheaper than lightImpact on most devices.
  void select() {
    if (_enabled) _fire(HapticFeedback.selectionClick());
  }
}

final hapticsProvider = Provider<Haptics>(Haptics.new);
