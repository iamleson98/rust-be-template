import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../chat/models.dart';
import '../chat/chat_service.dart';

/// Team availability: the `staff_presence` WS broadcasts with a REST
/// fallback (`GET /api/presence/staff`).
///
/// Drives the "who can take the next call" board and the NullClaw bot
/// status (bot owns support when no human is online).
class PresenceNotifier extends Notifier<StaffSnapshot?> {
  StreamSubscription<Map<String, dynamic>>? _sub;
  int _buildGeneration = 0;

  @override
  StaffSnapshot? build() {
    final generation = ++_buildGeneration;
    final svc = ref.watch(chatLiveServiceProvider);
    ref.onDispose(() => _sub?.cancel());
    if (svc == null) return null;

    _sub = svc.events.listen((msg) {
      if (msg['type'] == 'staff_presence' && msg['staff'] is List) {
        state = StaffSnapshot.fromJson(Map<String, dynamic>.from(msg));
      }
    }, onError: (_) {});

    Future(() {
      if (generation == _buildGeneration) refetch();
    });
    return null;
  }

  Future<void> refetch() async {
    try {
      final json = await ref.read(apiClientProvider).staffPresence();
      state = StaffSnapshot.fromJson(json);
    } catch (_) {
      // WS broadcasts will fill in; keep the last snapshot.
    }
  }
}

final staffPresenceProvider =
    NotifierProvider<PresenceNotifier, StaffSnapshot?>(
  PresenceNotifier.new,
);
