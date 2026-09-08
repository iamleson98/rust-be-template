import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:datxevui_support/app.dart';

void main() {
  // The app boots several platform integrations (SharedPreferences for the
  // server URL/theme, secure storage for tokens, local notifications).
  // Widget tests have no real platform channels — mock them so the boot
  // path completes.
  TestWidgetsFlutterBinding.ensureInitialized();
  SharedPreferences.setMockInitialValues({});
  final messenger = TestWidgetsFlutterBinding.instance.defaultBinaryMessenger;
  messenger.setMockMethodCallHandler(
    const MethodChannel('dexterous.com/flutter/local_notifications'),
    (call) async => null,
  );
  // Secure storage: all reads return null → no persisted session.
  messenger.setMockMethodCallHandler(
    const MethodChannel('plugins.it_nomads.com/flutter_secure_storage'),
    (call) async => null,
  );

  testWidgets('app boots: splash → login when signed out', (
    WidgetTester tester,
  ) async {
    // Build the app with an empty provider scope (no stored session).
    await tester.pumpWidget(const ProviderScope(child: DatXeVuiApp()));

    // First frames render the branded splash while the (empty) keystore
    // session is being restored.
    await tester.pump();
    expect(find.text('Tổng đài hỗ trợ'), findsOneWidget);

    // Session restore completes (no tokens) → login screen.
    await tester.pump(const Duration(milliseconds: 50));
    await tester.pumpAndSettle();
    expect(find.text('Đăng nhập nhân viên hỗ trợ'), findsOneWidget);
    expect(find.text('Đăng nhập'), findsWidgets);
  });
}
