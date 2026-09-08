import 'package:material_ui/material_ui.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:forui/forui.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:datxevui_support/core/auth/auth_controller.dart';
import 'package:datxevui_support/core/auth/token_store.dart';
import 'package:datxevui_support/core/design.dart';
import 'package:datxevui_support/core/net/api_client.dart';
import 'package:datxevui_support/features/chat/models.dart';
import 'package:datxevui_support/features/chat/room_screen.dart';
import 'package:datxevui_support/features/chat/rooms_controller.dart';
import 'package:datxevui_support/shared/widgets.dart';

/// A stub API client: deterministic in-memory channels + paginated
/// message history (newest-first, like the real backend).
class FakeApiClient extends ApiClient {
  FakeApiClient(this._channels, this._messagesNewestFirst)
      : super(baseUrl: 'http://localhost:9', tokens: TokenStore());

  final List<Map<String, dynamic>> _channels;
  final List<Map<String, dynamic>> _messagesNewestFirst;
  int messagePagesServed = 0;
  int sentCount = 0;

  @override
  Future<List<Map<String, dynamic>>> listChannels({int limit = 200}) async =>
      _channels;

  @override
  Future<List<Map<String, dynamic>>> listMessages(
    String channelId, {
    int limit = 30,
    int offset = 0,
  }) async {
    messagePagesServed++;
    return _messagesNewestFirst.skip(offset).take(limit).toList();
  }

  @override
  Future<Map<String, dynamic>> sendMessage(
    String channelId, {
    required String content,
    required String clientMsgId,
  }) async {
    sentCount++;
    return {
      'id': 'server-$sentCount',
      'channelId': channelId,
      'senderType': 'employee',
      'senderName': 'Agent Test',
      'content': content,
      'kind': 'text',
      'createdAt': DateTime.now().toUtc().toIso8601String(),
      'clientMsgId': clientMsgId,
    };
  }

  @override
  Future<void> markRead(String channelId) async {}

  @override
  Future<Map<String, dynamic>> channelAction(
    String channelId,
    String action,
  ) async =>
      _channels.first;
}

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
  messenger.setMockMethodCallHandler(
    const MethodChannel('plugins.it_nomads.com/flutter_secure_storage'),
    (call) async => null,
  );

  const channelId = 'chan-1';

  // 85 chronological messages: only the newest 3 land today, the rest
  // two days ago — the "Hôm nay" day chip then sits right at the live
  // edge (3rd newest), safely inside the built viewport. Sender groups
  // of 3 (customer) + 2 (agent) repeat.
  final chrono = <Map<String, dynamic>>[];
  var seq = 0;
  String isoAt(int index) {
    final dt = index < 82
        ? DateTime.now().subtract(const Duration(days: 2)).copyWith(
            hour: 9 + index ~/ 60,
            minute: index % 60,
            second: 0,
            millisecond: 0,
            microsecond: 0,
          )
        : DateTime.now().subtract(Duration(minutes: 85 - index));
    // Second precision like the backend.
    return '${dt.toUtc().toIso8601String().split('.').first}Z';
  }

  for (var i = 0; i < 85; i++) {
    seq++;
    final isCustomer = (i % 5) < 3;
    chrono.add({
      'id': 'm$i',
      'channelId': channelId,
      'senderType': isCustomer ? 'user' : 'employee',
      'senderId': isCustomer ? 'customer-1' : 'agent-1',
      'senderName': isCustomer ? 'Khách Hàng Test' : 'Agent Test',
      'content': 'Tin nhắn $seq ($i)',
      'kind': 'text',
      'createdAt': isoAt(i),
    });
  }

  final channels = <Map<String, dynamic>>[
    {
      'id': channelId,
      'userId': 'customer-1',
      'status': 'open',
      'createdAt': isoAt(0),
      'lastMessageAt': isoAt(84),
      'lastMessagePreview': 'Tin nhắn 85 (84)',
      'unreadEmployee': 0,
      'user': {
        'id': 'customer-1',
        'fullName': 'Khách Hàng Test',
        'email': 'khach@test.vn',
      },
      'assignedTo': null,
      'assignedToMe': false,
    },
  ];

  // The backend serves newest-first.
  final newestFirst = chrono.reversed.toList();

  Widget harness(ProviderContainer container) => UncontrolledProviderScope(
        container: container,
        child: FTheme(
          data: vexevnTheme(dark: false),
          child: MaterialApp(
            home: RoomScreen(channelId: channelId),
          ),
        ),
      );

  testWidgets('chat room renders groups, day chips, and pages in older '
      'history on demand', (WidgetTester tester) async {
    // Tall viewport: every row of the first page builds (deterministic
    // grouping assertions — no cache-extent roulette).
    tester.view.physicalSize = const Size(800, 5000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final fake = FakeApiClient(channels, newestFirst);
    final container = ProviderContainer(overrides: [
      apiClientProvider.overrideWithValue(fake),
    ]);
    addTearDown(container.dispose);

    await tester.pumpWidget(harness(container));
    await tester.pump(); // open() kicks off.
    await tester.pumpAndSettle();

    // First page: 40 newest messages landed and rendered.
    final room = container.read(roomsProvider)[channelId]!;
    expect(room.messages.length, 40);
    expect(room.hasMore, isTrue);
    expect(fake.messagePagesServed, 1);

    // Day chip for today's block is visible.
    expect(find.text('Hôm nay'), findsOneWidget);

    // Newest message is on screen.
    expect(find.text('Tin nhắn 85 (84)'), findsOneWidget);

    // Grouped incoming bubbles: the avatar (size 30) docks only on each
    // customer group's visual bottom. The 40 newest messages span
    // chronological indices 45..84 — exactly 8 sender cycles of (3
    // customer + 2 agent), so exactly 8 customer-group avatars.
    final bubbleAvatars = find.byWidgetPredicate(
      (w) => w is AgentAvatar && w.size == 30,
    );
    // Expected customer-group avatars in the first page (45..84): the 8
    // full customer groups (…47, 52, 57, 62, 67, 72, 77) PLUS the group
    // split by the day boundary — [80, 81] (two days ago) and the lone
    // [82] (first of today) each dock an avatar. Telegram-style.
    const expectedGroupAvatars = 9;
    expect(bubbleAvatars.evaluate().length, expectedGroupAvatars);

    // Ask for the next older page (the same call the scroll listener
    // fires near the top of the reverse list).
    await container.read(roomsProvider.notifier).loadOlder(channelId);
    await tester.pumpAndSettle();

    expect(container.read(roomsProvider)[channelId]!.messages.length, 80);
    expect(fake.messagePagesServed, 2);

    // Final page: history reaches the beginning (2 days ago).
    await container.read(roomsProvider.notifier).loadOlder(channelId);
    await tester.pumpAndSettle();

    final full = container.read(roomsProvider)[channelId]!;
    expect(full.messages.length, 85);
    expect(full.hasMore, isFalse, reason: 'short page → no more history');
    expect(full.messages.first.id, 'm0');

    // Swiping up (finger down) walks into history: the oldest message
    // and its day divider are reachable.
    for (var i = 0; i < 6; i++) {
      await tester.drag(find.byType(ListView), const Offset(0, 2500));
      await tester.pumpAndSettle();
    }
    expect(find.text('Tin nhắn 1 (0)'), findsOneWidget);
    expect(find.textContaining('tháng'), findsWidgets);
  });

  testWidgets('composer morphs and sends optimistically', (
    WidgetTester tester,
  ) async {
    final fake = FakeApiClient(channels, newestFirst);
    final container = ProviderContainer(overrides: [
      apiClientProvider.overrideWithValue(fake),
    ]);
    addTearDown(container.dispose);

    await tester.pumpWidget(harness(container));
    await tester.pump();
    await tester.pumpAndSettle();

    final before =
        container.read(roomsProvider)[channelId]!.messages.length;

    // Type → the composer updates; tap send → optimistic bubble appears.
    await tester.enterText(find.byType(TextField), 'Xin chào khách');
    await tester.pump();

    await tester.tap(find.bySemanticsLabel('Gửi tin nhắn'));
    await tester.pump();
    await tester.pumpAndSettle();

    // Reconciled with the server row: count grew by 1, state is sent.
    final room = container.read(roomsProvider)[channelId]!;
    expect(fake.sentCount, 1);
    expect(room.messages.length, before + 1);
    expect(room.messages.last.content, 'Xin chào khách');
    expect(room.messages.last.sendState, SendState.sent);
    expect(find.text('Xin chào khách'), findsOneWidget);

    // The typing stopwatch (1.5s auto-stop) must fire before the test
    // ends — otherwise the binding flags a pending timer.
    await tester.pump(const Duration(milliseconds: 1600));
    await tester.pumpAndSettle();
  });

  testWidgets('pop guard: back action routes through go_router pop',
      (WidgetTester tester) async {
    // RoomScreen's back button calls context.pop() — build it inside a
    // tiny router so the call site is exercised.
    final fake = FakeApiClient(channels, newestFirst);
    final container = ProviderContainer(overrides: [
      apiClientProvider.overrideWithValue(fake),
    ]);
    addTearDown(container.dispose);

    final router = GoRouter(
      initialLocation: '/chat/$channelId',
      routes: [
        GoRoute(
          path: '/chat',
          builder: (c, s) => const Scaffold(body: SizedBox.expand()),
          routes: [
            GoRoute(
              path: ':channelId',
              builder: (c, s) => RoomScreen(
                channelId: s.pathParameters['channelId']!,
              ),
            ),
          ],
        ),
      ],
    );

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: FTheme(
          data: vexevnTheme(dark: false),
          child: MaterialApp.router(routerConfig: router),
        ),
      ),
    );
    await tester.pump();
    await tester.pumpAndSettle();

    expect(find.byType(RoomScreen), findsOneWidget);

    await tester.tap(find.bySemanticsLabel('Quay lại').evaluate().isNotEmpty
        ? find.bySemanticsLabel('Quay lại')
        : find.byIcon(FLucideIcons.chevronLeft));
    await tester.pumpAndSettle();

    expect(find.byType(RoomScreen), findsNothing);
  });
}
