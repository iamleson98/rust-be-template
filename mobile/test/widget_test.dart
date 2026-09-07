import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:vexevn_support/app.dart';

void main() {
  // The app boots several platform integrations (SharedPreferences for the
  // server URL/theme, local notifications). Widget tests have no real
  // platform channels — mock them so the boot path completes.
  TestWidgetsFlutterBinding.ensureInitialized();
  SharedPreferences.setMockInitialValues({});
  TestWidgetsFlutterBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(
    const MethodChannel('dexterous.com/flutter/local_notifications'),
    (call) async => null,
  );

  testWidgets('app boots to the login screen when signed out', (
    WidgetTester tester,
  ) async {
    // Build the app with an empty provider scope (no stored session).
    await tester.pumpWidget(const ProviderScope(child: VeXevnApp()));

    // First frame: the login screen renders its staff-login heading.
    await tester.pump();
    expect(find.text('Đăng nhập nhân viên hỗ trợ'), findsOneWidget);
    expect(find.text('Đăng nhập'), findsWidgets);
    // Let pending boot microtasks/timers flush before teardown.
    await tester.pumpAndSettle();
  });
}
