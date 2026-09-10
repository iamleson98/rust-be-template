import 'package:datxevui_support/core/duty_mode.dart';
import 'package:datxevui_support/core/env.dart';
import 'package:datxevui_support/core/settings.dart';
import 'package:datxevui_support/core/theme_mode.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('alert preferences restore after restart', () async {
    final firstRun = ProviderContainer();
    await firstRun.read(alertsEnabledProvider.notifier).set(false);
    await firstRun.read(soundEnabledProvider.notifier).set(false);
    await firstRun.read(vibrateEnabledProvider.notifier).set(false);
    firstRun.dispose();

    final restarted = ProviderContainer();
    restarted.read(alertsEnabledProvider);
    restarted.read(soundEnabledProvider);
    restarted.read(vibrateEnabledProvider);
    await _completePreferenceLoads();

    expect(restarted.read(alertsEnabledProvider), isFalse);
    expect(restarted.read(soundEnabledProvider), isFalse);
    expect(restarted.read(vibrateEnabledProvider), isFalse);
    restarted.dispose();
  });

  test('theme restores after restart', () async {
    final firstRun = ProviderContainer();
    await firstRun.read(themeModeProvider.notifier).set(ThemeMode.dark);
    firstRun.dispose();

    final restarted = ProviderContainer();
    restarted.read(themeModeProvider);
    await _completePreferenceLoads();

    expect(restarted.read(themeModeProvider), ThemeMode.dark);
    restarted.dispose();
  });

  test('server URL restores after restart', () async {
    final firstRun = ProviderContainer();
    await firstRun
        .read(appConfigProvider.notifier)
        .setServerUrl('https://support.example.com/api');
    firstRun.dispose();

    final restarted = ProviderContainer();
    restarted.read(appConfigProvider);
    await _completePreferenceLoads();

    expect(
      restarted.read(appConfigProvider).baseUrl,
      'https://support.example.com/api',
    );
    restarted.dispose();
  });

  test('duty mode restores after restart', () async {
    final firstRun = ProviderContainer();
    await firstRun.read(dutyModeProvider.notifier).set(true);
    firstRun.dispose();

    final restarted = ProviderContainer();
    restarted.read(dutyModeProvider);
    await _completePreferenceLoads();

    expect(restarted.read(dutyModeProvider), isTrue);
    restarted.dispose();
  });
}

Future<void> _completePreferenceLoads() => Future<void>.delayed(Duration.zero);