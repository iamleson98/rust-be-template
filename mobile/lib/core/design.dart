/// "đặt xe vui" design language.
///
/// A violet/fuchsia brand system applied on top of Forui's token set:
///   * [AppBrand] — raw color constants (light + dark) used for gradients and
///     custom-painted widgets that live outside the Forui token space;
///   * [FColors] / [FThemeData] — full Forui themes ([vexevnLight] /
///     [vexevnDark]) so every Forui widget (buttons, cards, bottom nav,
///     toasts…) picks up the purple identity automatically;
///   * [AppMotion] — shared curves/durations so screen transitions feel
///     consistent app-wide.
///
/// Palette: violet-600 primary with a fuchsia accent (Telegram-iMessage
/// style), purple-tinted neutrals instead of pure grays, deep purple-black
/// dark surface stack.
library;

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';
import 'package:forui/forui.dart';

/// Raw brand colors + gradients (outside the FColors token set).
abstract final class AppBrand {
  // ── Core hues ──────────────────────────────────────────────────────
  /// Violet-600 — the primary action color (buttons, links, active tabs).
  static const Color violet = Color(0xFF7C3AED);

  /// Violet-700 — pressed/emphasized primary.
  static const Color violetDeep = Color(0xFF6D28D9);

  /// Purple-500 — bubble gradient end.
  static const Color purple = Color(0xFF9333EA);

  /// Fuchsia-600 — hero/brand gradient end.
  static const Color fuchsia = Color(0xFFC026D3);

  /// Success green (presence dots, delivered ticks, accept call).
  static const Color success = Color(0xFF22C55E);

  // ── Gradients ──────────────────────────────────────────────────────
  /// Outgoing message bubble: violet → purple (subtle, modern).
  static const LinearGradient bubbleGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [violet, purple],
  );

  /// Brand hero (splash/login/call): violet → fuchsia.
  static const LinearGradient heroGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [violet, fuchsia],
  );

  /// Soft vertical wash for screen headers in light mode.
  static LinearGradient headerWash(Color base) => LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [base.withValues(alpha: 0.06), base.withValues(alpha: 0.0)],
      );

  /// Deterministic avatar gradient per name-hash so different customers
  /// get different (but stable) purple-family hues.
  static List<Color> avatarColors(String seed) {
    const palettes = [
      [Color(0xFF7C3AED), Color(0xFF9333EA)],
      [Color(0xFF8B5CF6), Color(0xFFC084FC)],
      [Color(0xFF9333EA), Color(0xFFD946EF)],
      [Color(0xFF6366F1), Color(0xFF8B5CF6)],
      [Color(0xFFC026D3), Color(0xFFE879F9)],
      [Color(0xFF7C3AED), Color(0xFF6366F1)],
    ];
    var h = 0;
    for (final c in seed.codeUnits) {
      h = (h * 31 + c) & 0x7fffffff;
    }
    return palettes[h % palettes.length];
  }
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

/// Forui color scheme — light, purple-tinted.
FColors get _vexevnLight => FColors(
      brightness: Brightness.light,
      systemOverlayStyle: SystemUiOverlayStyle.dark,
      barrier: const Color(0x33000000),
      background: const Color(0xFFF8F6FD),
      foreground: const Color(0xFF191225),
      primary: AppBrand.violet,
      primaryForeground: const Color(0xFFFFFFFF),
      secondary: const Color(0xFFEDE8FB),
      secondaryForeground: const Color(0xFF4C1D95),
      muted: const Color(0xFFECE8F8),
      mutedForeground: const Color(0xFF6E688C),
      destructive: const Color(0xFFE11D48),
      destructiveForeground: const Color(0xFFFFFFFF),
      error: const Color(0xFFE11D48),
      errorForeground: const Color(0xFFFFFFFF),
      card: const Color(0xFFFFFFFF),
      border: const Color(0xFFE6E0F4),
    );

/// Forui color scheme — dark, deep purple stack.
FColors get _vexevnDark => FColors(
      brightness: Brightness.dark,
      systemOverlayStyle: SystemUiOverlayStyle.light,
      barrier: const Color(0x7A000000),
      background: const Color(0xFF0E0B16),
      foreground: const Color(0xFFF4F1FB),
      primary: const Color(0xFF8B5CF6),
      primaryForeground: const Color(0xFFF8F5FF),
      secondary: const Color(0xFF221B36),
      secondaryForeground: const Color(0xFFDDD6FE),
      muted: const Color(0xFF221C36),
      mutedForeground: const Color(0xFFA7A1C8),
      destructive: const Color(0xFFFB7185),
      destructiveForeground: const Color(0xFF14101F),
      error: const Color(0xFFFB7185),
      errorForeground: const Color(0xFF14101F),
      card: const Color(0xFF181226),
      border: const Color(0x1FFFFFFF),
    );

/// Touch-optimized Forui theme for the app.
FThemeData vexevnTheme({required bool dark}) => FThemeData(
      colors: dark ? _vexevnDark : _vexevnLight,
      touch: true,
      debugLabel: dark ? 'Đặt Xe Vui Dark Touch' : 'Đặt Xe Vui Light Touch',
    );
