import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/net/api_client.dart';
import 'chat_service.dart';
import 'models.dart';

/// The agent's support queue: all channels (newest activity first),
/// refreshed from REST and kept fresh by WS broadcasts.
///
/// WS events (`channel_message`, `channel_created`, assignment changes)
/// trigger a **debounced refetch** (single source of truth = REST), while
/// `channel_message` additionally patches the affected row immediately so
/// the list preview/unread badge updates without waiting for the round-trip.
class ConversationsNotifier extends Notifier<AsyncValue<List<Channel>>> {
  StreamSubscription<Map<String, dynamic>>? _sub;
  Timer? _debounce;
  bool _fetching = false;
  int _buildGeneration = 0;

  @override
  AsyncValue<List<Channel>> build() {
    final generation = ++_buildGeneration;
    final svc = ref.watch(chatLiveServiceProvider);
    ref.onDispose(() {
      _sub?.cancel();
      _debounce?.cancel();
    });
    if (svc == null) {
      return AsyncValue<List<Channel>>.data(const []);
    }
    _sub = svc.events.listen(_onEvent, onError: (_) {});
    Future(() {
      if (generation == _buildGeneration) refetch(showSpinner: false);
    });
    return AsyncValue<List<Channel>>.loading();
  }

  Future<void> refetch({bool showSpinner = true}) async {
    if (_fetching) return;
    _fetching = true;
    if (showSpinner && state.value == null) {
      state = AsyncValue<List<Channel>>.loading();
    }
    try {
      final items = await ref.read(apiClientProvider).listChannels();
      final channels = items.map(Channel.fromJson).toList();
      state = AsyncValue.data(channels);
    } catch (e, st) {
      state = AsyncValue<List<Channel>>.error(e, st);
    } finally {
      _fetching = false;
    }
  }

  void _onEvent(Map<String, dynamic> msg) {
    switch (msg['type'] as String?) {
      // A customer sent a message somewhere in the queue. Patch the row
      // now (preview + unread), then refetch to reconcile assignments.
      case 'channel_message':
        _patchChannelMessage(msg);
        _scheduleRefetch();
      case 'channel_created':
      case 'channels_changed':
      case 'channel_assigned':
      case 'channel_released':
      case 'channel_closed':
        _scheduleRefetch();
      case 'message':
        // Own room broadcast — the rooms controller owns full detail, but
        // the queue row's preview should refresh too.
        _patchChannelMessage(msg);
    }
  }

  void _patchChannelMessage(Map<String, dynamic> msg) {
    final channelId = msg['channelId'] as String?;
    if (channelId == null) return;
    final preview =
        (msg['preview'] ?? msg['text'] ?? msg['content']) as String?;
    final createdAt = msg['createdAt'] as String?;
    final senderType = (msg['senderType'] ?? 'user') as String;
    // Only customer/bot messages count toward the agent's unread badge.
    final fromCustomer =
        senderType == 'user' || senderType == 'assistant';

    final current = state.value;
    if (current == null) return;
    var touched = false;
    final next = current.map((c) {
      if (c.id != channelId) return c;
      touched = true;
      return c.copyWith(
        lastMessageAt: createdAt,
        lastMessagePreview: preview ?? c.lastMessagePreview,
        unreadEmployee: fromCustomer ? c.unreadEmployee + 1 : 0,
      );
    }).toList();
    if (touched) state = AsyncValue.data(next);
  }

  /// Debounced refetch — bursts of messages produce one round-trip.
  void _scheduleRefetch() {
    _debounce ??= Timer(const Duration(milliseconds: 400), () {
      _debounce = null;
      refetch(showSpinner: false);
    });
  }

  /// Local echo of "agent read this channel" (the REST call is issued by
  /// the rooms controller; this just clears the badge immediately).
  void markReadLocally(String channelId) {
    final current = state.value;
    if (current == null) return;
    var touched = false;
    final next = current.map((c) {
      if (c.id != channelId) return c;
      touched = true;
      return c.copyWith(unreadEmployee: 0);
    }).toList();
    if (touched) state = AsyncValue.data(next);
  }

  /// Queue actions: claim / release / close. The REST response carries the
  /// post-action channel state, which we merge into the list.
  Future<String?> channelAction(String channelId, String action) async {
    try {
      final json = await ref
          .read(apiClientProvider)
          .channelAction(channelId, action);
      final updated = Channel.fromJson(json);
      final current = state.value ?? const <Channel>[];
      state = AsyncValue.data([
        for (final c in current)
          if (c.id == updated.id) updated else c,
      ]);
      return null;
    } on ApiException catch (e) {
      return e.message;
    } catch (_) {
      return 'Không thực hiện được thao tác';
    }
  }
}

final conversationsProvider =
    NotifierProvider<ConversationsNotifier, AsyncValue<List<Channel>>>(
  ConversationsNotifier.new,
);

// ── Queue filter tab ─────────────────────────────────────────────────

enum QueueFilter { all, unassigned, mine }

class QueueFilterNotifier extends Notifier<QueueFilter> {
  @override
  QueueFilter build() => QueueFilter.all;

  void set(QueueFilter filter) => state = filter;
}

final queueFilterProvider =
    NotifierProvider<QueueFilterNotifier, QueueFilter>(
  QueueFilterNotifier.new,
);

/// Filtered view of the queue for the list screen.
final filteredChannelsProvider = Provider<List<Channel>>((ref) {
  final channels = ref.watch(conversationsProvider).value ?? [];
  final filter = ref.watch(queueFilterProvider);
  switch (filter) {
    case QueueFilter.unassigned:
      return channels.where((c) => c.isOpen && !c.assignedToMe).toList();
    case QueueFilter.mine:
      return channels.where((c) => c.assignedToMe && !c.isClosed).toList();
    case QueueFilter.all:
      return channels;
  }
});

/// Total unread across the queue (bottom-nav badge).
final totalUnreadProvider = Provider<int>((ref) {
  final channels = ref.watch(conversationsProvider).value ?? [];
  var total = 0;
  for (final c in channels) {
    total += c.unreadEmployee;
  }
  return total;
});
