import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:forui/forui.dart';

import 'package:datxevui_support/core/design.dart';
import 'package:datxevui_support/features/call/call_controller.dart';
import 'package:datxevui_support/features/call/call_screen.dart';
import 'package:datxevui_support/features/call/call_state.dart';

/// A [CallController] stand-in that never touches WebRTC or the
/// signaling socket — tests drive it by publishing [CallUiState]s the
/// way the real controller does on `incoming` frames.
class FakeCallController extends CallController {
  FakeCallController(this.initialState);

  /// The state the controller starts with (the real one starts at
  /// `CallUiState()` and mutates on signaling frames).
  final CallUiState initialState;

  @override
  CallUiState build() => initialState;

  bool declined = false;
  bool accepted = false;

  @override
  Future<void> accept() async => accepted = true;

  @override
  void decline() => declined = true;
}

void main() {
  Widget harness(ProviderContainer container) => UncontrolledProviderScope(
    container: container,
    child: FTheme(
      data: vexevnTheme(dark: false),
      child: const MaterialApp(home: CallScreen()),
    ),
  );

  ProviderContainer containerWith(CallUiState state) => ProviderContainer(
    overrides: [
      callUiStateProvider.overrideWith(() => FakeCallController(state)),
    ],
  );

  testWidgets('incoming call shows the CALLER identity — name from the frame', (
    WidgetTester tester,
  ) async {
    final container = containerWith(
      const CallUiState(
        status: CallStatus.incoming,
        peerId: 'customer-9',
        peerName: 'Nguyễn Văn A',
        channelId: 'ch-77',
        remoteOffer: {'type': 'offer', 'sdp': 'v=0'},
      ),
    );
    addTearDown(container.dispose);

    await tester.pumpWidget(harness(container));
    // The ringing avatar pulses forever — pump a fixed slice instead
    // of pumpAndSettle (which would wait for it to "finish").
    await tester.pump(const Duration(milliseconds: 350));

    // The caller's name leads the screen — an agent must see WHO is
    // calling before deciding to pick up.
    expect(find.text('Nguyễn Văn A'), findsOneWidget);
    expect(find.text('Cuộc gọi đến…'), findsOneWidget);
    // Initials avatar fallback renders the same identity.
    expect(find.text('NA'), findsOneWidget);
    // Accept / decline controls are reachable and labelled.
    expect(find.bySemanticsLabel('Từ chối'), findsOneWidget);
    expect(find.bySemanticsLabel('Nghe máy'), findsOneWidget);
  });

  testWidgets('incoming call without a captured name falls back to the generic '
      'customer label', (WidgetTester tester) async {
    final container = containerWith(
      const CallUiState(status: CallStatus.incoming, peerId: 'customer-9'),
    );
    addTearDown(container.dispose);

    await tester.pumpWidget(harness(container));
    await tester.pump(const Duration(milliseconds: 350));

    expect(find.text('Khách hàng'), findsOneWidget);
  });

  testWidgets('active call shows the live duration timer', (tester) async {
    final container = containerWith(
      const CallUiState(
        status: CallStatus.active,
        peerId: 'customer-9',
        peerName: 'Nguyễn Văn A',
        startedAt: null,
      ),
    );
    addTearDown(container.dispose);

    await tester.pumpWidget(harness(container));
    await tester.pump(const Duration(milliseconds: 350));

    // The ticker needs a startedAt — the screen seeds "now" when the
    // server sent none. What must exist is the mm:ss readout + the
    // hangup / mic / speaker controls.
    expect(find.bySemanticsLabel('Kết thúc cuộc gọi'), findsOneWidget);
    expect(find.bySemanticsLabel('Bật/tắt micro'), findsOneWidget);
    expect(find.bySemanticsLabel('Loa ngoài'), findsOneWidget);
  });

  testWidgets('decline routes into the shared call controller', (tester) async {
    final controller = FakeCallController(
      const CallUiState(
        status: CallStatus.incoming,
        peerId: 'customer-9',
        peerName: 'Nguyễn Văn A',
        remoteOffer: {'type': 'offer', 'sdp': 'v=0'},
      ),
    );
    final container = ProviderContainer(
      overrides: [callUiStateProvider.overrideWith(() => controller)],
    );
    addTearDown(container.dispose);

    await tester.pumpWidget(harness(container));
    await tester.pump(const Duration(milliseconds: 350));

    await tester.tap(find.bySemanticsLabel('Từ chối'));
    await tester.pump(const Duration(milliseconds: 100));

    expect(controller.declined, isTrue);
    expect(controller.accepted, isFalse);
  });
}
