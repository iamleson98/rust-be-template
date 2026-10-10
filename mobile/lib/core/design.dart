/// "đặt xe vui" design language — the same look as the website and its
/// consoles: the brand blue on a soft canvas, white cards with a hairline
/// border and a whisper of shadow, calm tinted chips instead of gradients.
///
///   * [AppBrand] — raw brand colors for custom-painted widgets outside
///     the Forui token space;
///   * [AppShadow] — the one soft elevation (cards lift off the canvas);
///   * [FColors] / [FThemeData] — full Forui themes so every Forui widget
///     (buttons, fields, tiles, toasts…) picks up the brand automatically;
///   * [AppMotion] — shared curves/durations.
library;

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';
import 'package:forui/forui.dart';

/// Raw brand colors (outside the FColors token set).
abstract final class AppBrand {
  /// The website's primary blue — buttons, links, active tabs, own bubbles.
  static const Color primary = Color(0xFF0063C4);

  /// Pressed/emphasized primary.
  static const Color primaryDeep = Color(0xFF00519F);

  /// The logo heart's orange — used sparingly for warmth (badges).
  static const Color accent = Color(0xFFF97316);

  /// Presence dots, "ready" chips, accept-call.
  static const Color success = Color(0xFF22C55E);

  /// Waiting / needs-attention chips.
  static const Color warning = Color(0xFFD97706);

  /// Calm tinted avatar (background, initials) per name — stable per
  /// person, varied enough to tell people apart at a glance.
  static (Color, Color) avatarTone(String seed) {
    const tones = [
      (Color(0xFFE0EDFB), Color(0xFF0063C4)), // blue
      (Color(0xFFDCF5EE), Color(0xFF0F8A68)), // teal
      (Color(0xFFFDEBD8), Color(0xFFC2560C)), // orange
      (Color(0xFFFBE3EA), Color(0xFFBE185D)), // rose
      (Color(0xFFEDE7FB), Color(0xFF6D28D9)), // violet
      (Color(0xFFFDF3D3), Color(0xFFA16207)), // amber
    ];
    var h = 0;
    for (final c in seed.codeUnits) {
      h = (h * 31 + c) & 0x7fffffff;
    }
    return tones[h % tones.length];
  }
}

/// The one elevation: cards lift off the canvas without a heavy shadow.
abstract final class AppShadow {
  static const List<BoxShadow> soft = [
    BoxShadow(color: Color(0x0A0F172A), blurRadius: 2, offset: Offset(0, 1)),
    BoxShadow(
      color: Color(0x0F0F172A),
      blurRadius: 8,
      spreadRadius: -2,
      offset: Offset(0, 2),
    ),
  ];

  /// Floating controls (jump-to-latest, the call bar).
  static const List<BoxShadow> float = [
    BoxShadow(color: Color(0x0D0F172A), blurRadius: 2, offset: Offset(0, 1)),
    BoxShadow(
      color: Color(0x380F172A),
      blurRadius: 24,
      spreadRadius: -10,
      offset: Offset(0, 10),
    ),
  ];
}

/// Motion tokens shared by router transitions and micro-animations.
abstract final class AppMotion {
  /// Standard emphasized-decelerate for page pushes.
  static const Curve easeOutCubic = Cubic(0.22, 1, 0.36, 1);

  /// Standard accelerate for pops.
  static const Curve easeInCubic = Cubic(0.64, 0, 0.78, 0);

  /// Spring-ish overshoot for playful reveals (badges, FABs).
  static const Curve overshoot = Cubic(0.34, 1.56, 0.64, 1);

  static const Duration page = Duration(milliseconds: 300);
  static const Duration quick = Duration(milliseconds: 180);
}

/// Forui color scheme — light: slate neutrals on the website's canvas.
FColors get _lightColors => FColors(
  brightness: Brightness.light,
  systemOverlayStyle: SystemUiOverlayStyle.dark,
  barrier: const Color(0x330F172A),
  background: const Color(0xFFF7F8FA),
  foreground: const Color(0xFF0F172A),
  primary: AppBrand.primary,
  primaryForeground: const Color(0xFFFFFFFF),
  secondary: const Color(0xFFEEF2F7),
  secondaryForeground: const Color(0xFF0F172A),
  muted: const Color(0xFFF1F5F9),
  mutedForeground: const Color(0xFF64748B),
  destructive: const Color(0xFFE11D48),
  destructiveForeground: const Color(0xFFFFFFFF),
  error: const Color(0xFFE11D48),
  errorForeground: const Color(0xFFFFFFFF),
  card: const Color(0xFFFFFFFF),
  border: const Color(0xFFE2E8F0),
);

/// Forui color scheme — dark: deep slate stack, a lighter brand blue.
FColors get _darkColors => FColors(
  brightness: Brightness.dark,
  systemOverlayStyle: SystemUiOverlayStyle.light,
  barrier: const Color(0x7A000000),
  background: const Color(0xFF0B1220),
  foreground: const Color(0xFFF1F5F9),
  primary: const Color(0xFF3B8EE6),
  primaryForeground: const Color(0xFFFFFFFF),
  secondary: const Color(0xFF1E293B),
  secondaryForeground: const Color(0xFFE2E8F0),
  muted: const Color(0xFF1E293B),
  mutedForeground: const Color(0xFF94A3B8),
  destructive: const Color(0xFFFB7185),
  destructiveForeground: const Color(0xFF0B1220),
  error: const Color(0xFFFB7185),
  errorForeground: const Color(0xFF0B1220),
  card: const Color(0xFF111A2B),
  border: const Color(0x1FFFFFFF),
);

/// Touch-optimized Forui theme for the app.
FThemeData vexevnTheme({required bool dark}) => FThemeData(
  colors: dark ? _darkColors : _lightColors,
  touch: true,
  debugLabel: dark ? 'Đặt Xe Vui Dark Touch' : 'Đặt Xe Vui Light Touch',
);
