import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/net/ws_client.dart';
import 'chat_service.dart';
import 'conversations_controller.dart';
import 'models.dart';

/// Which customers are online — signed in with the site open — from the
/// `GET /api/chat/channels/online` snapshot plus the `customer_presence`
/// events newer than it.
///
/// Snapshot and events carry the hub's presence sequence number: a page
/// refresh closes one socket and opens another within milliseconds, and
/// the two events (or an event and the snapshot) can arrive in either
/// order, so the higher number wins.
@immutable
class CustomerPresence {
  const CustomerPresence({
    this.seq = 0,
    this.snapshot = const {},
    this.events = const {},
    this.channels = const [],
  });

  /// Sequence number the snapshot is at least as new as.
  final int seq;

  /// Customers online when the snapshot was taken.
  final Set<String> snapshot;

  /// The newest event per customer.
  final Map<String, ({bool online, int seq})> events;

  /// Open channels of online customers, including ones the queue list
  /// has not loaded.
  final List<Channel> channels;

  bool isOnline(String userId) {
    final event = events[userId];
    if (event != null && event.seq > seq) return event.online;
    return snapshot.contains(userId);
  }

  /// A newer snapshot replaces this one; events it covers are dropped.
  CustomerPresence withSnapshot(
    int seq,
    Set<String> userIds,
    List<Channel> channels,
  ) {
    if (seq < this.seq) return this;
    return CustomerPresence(
      seq: seq,
      snapshot: userIds,
      events: Map.fromEntries(events.entries.where((e) => e.value.seq > seq)),
      channels: channels,
    );
  }

  /// Records the event unless the snapshot or an equal or newer event for
  /// the same customer already covers it.
  CustomerPresence withEvent(String userId, bool online, int seq) {
    final prev = events[userId];
    if (seq <= this.seq || (prev != null && prev.seq >= seq)) return this;
    return CustomerPresence(
      seq: this.seq,
      snapshot: snapshot,
      events: {...events, userId: (online: online, seq: seq)},
      channels: channels,
    );
  }
}

/// [channels] with the customers online right now first, each group most
/// recent activity first.
List<Channel> onlineFirst(
  Iterable<Channel> channels,
  CustomerPresence presence,
) {
  final online = <Channel>[];
  final rest = <Channel>[];
  for (final c in channels) {
    (presence.isOnline(c.userId) ? online : rest).add(c);
  }
  online.sort(_newestFirst);
  rest.sort(_newestFirst);
  return [...online, ...rest];
}

/// How many of [channels], ordered by [onlineFirst], lead with an online
/// customer.
int onlineLead(List<Channel> channels, CustomerPresence presence) =>
    channels.takeWhile((c) => presence.isOnline(c.userId)).length;

int _newestFirst(Channel a, Channel b) {
  final byTime = _activity(b).compareTo(_activity(a));
  return byTime != 0 ? byTime : a.id.compareTo(b.id);
}

DateTime _activity(Channel c) =>
    DateTime.tryParse(c.lastMessageAt ?? c.createdAt) ?? DateTime(0);

/// Keeps [CustomerPresence] current: fetches the snapshot whenever the
/// chat socket (re)connects — events may have been missed meanwhile — and
/// applies `customer_presence` events as they arrive.
class CustomerPresenceNotifier extends Notifier<CustomerPresence> {
  StreamSubscription<Map<String, dynamic>>? _eventsSub;
  StreamSubscription<WsStatus>? _statusSub;
  bool _fetching = false;
  bool _fetchAgain = false;
  int _buildGeneration = 0;

  @override
  CustomerPresence build() {
    final generation = ++_buildGeneration;
    final svc = ref.watch(chatLiveServiceProvider);
    ref.onDispose(() {
      _eventsSub?.cancel();
      _statusSub?.cancel();
    });
    if (svc == null) return const CustomerPresence();
    _eventsSub = svc.events.listen(_onEvent, onError: (_) {});
    _statusSub = svc.connectionStates.listen((status) {
      if (status == WsStatus.connected) unawaited(refresh());
    });
    if (svc.isConnected) {
      Future(() {
        if (generation == _buildGeneration) unawaited(refresh());
      });
    }
    return const CustomerPresence();
  }

  /// Fetches the snapshot; a request made while one is in flight runs
  /// once it lands, so the newest state always wins.
  Future<void> refresh() async {
    if (_fetching) {
      _fetchAgain = true;
      return;
    }
    _fetching = true;
    try {
      do {
        _fetchAgain = false;
        final json = await ref.read(apiClientProvider).onlineChannels();
        final seq = (json['seq'] as num?)?.toInt() ?? 0;
        final ids = json['userIds'] as List? ?? const [];
        final items = json['items'] as List? ?? const [];
        final channels = items.whereType<Map<String, dynamic>>();
        state = state.withSnapshot(
          seq,
          ids.whereType<String>().toSet(),
          channels.map(Channel.fromJson).toList(),
        );
      } while (_fetchAgain);
    } catch (_) {
      // Best effort — the next reconnect or arrival fetches again.
    } finally {
      _fetching = false;
    }
  }

  void _onEvent(Map<String, dynamic> msg) {
    if (msg['type'] != 'customer_presence') return;
    final userId = msg['userId'] as String?;
    final seq = (msg['seq'] as num?)?.toInt();
    if (userId == null || seq == null) return;
    final online = msg['online'] as bool? ?? false;
    state = state.withEvent(userId, online, seq);
    if (!online) return;

    // An open channel the lists lack: fetch it so it shows at the top.
    // No ids means the server could not look them up.
    final ids = msg['channelIds'];
    final queue = ref.read(conversationsProvider).value ?? const <Channel>[];
    final known = {
      for (final c in queue) c.id,
      for (final c in state.channels) c.id,
    };
    if (ids is! List || ids.any((id) => !known.contains(id))) {
      unawaited(refresh());
    }
  }
}

final customerPresenceProvider =
    NotifierProvider<CustomerPresenceNotifier, CustomerPresence>(
      CustomerPresenceNotifier.new,
    );
