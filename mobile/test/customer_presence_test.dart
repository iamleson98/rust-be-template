import 'package:flutter_test/flutter_test.dart';

import 'package:datxevui_support/features/chat/customer_presence.dart';
import 'package:datxevui_support/features/chat/models.dart';

Channel _channel(String id, String userId, String at) => Channel.fromJson({
  'id': id,
  'userId': userId,
  'status': 'open',
  'createdAt': at,
  'lastMessageAt': at,
});

void main() {
  group('CustomerPresence', () {
    test('applies only the events newer than the snapshot', () {
      var presence = const CustomerPresence();
      presence = presence.withEvent('a', false, 4);
      presence = presence.withEvent('b', true, 6);
      presence = presence.withSnapshot(5, {'a'}, const []);
      expect(presence.isOnline('a'), isTrue);
      expect(presence.isOnline('b'), isTrue);
      expect(presence.events.keys.toList(), ['b']);
    });

    test('keeps the newest event per customer, whatever the order', () {
      var presence = const CustomerPresence();
      presence = presence.withEvent('a', true, 3); // reopened tab…
      presence = presence.withEvent('a', false, 2); // …its close, late
      expect(presence.isOnline('a'), isTrue);
    });

    test('ignores a snapshot older than the one it has', () {
      var presence = const CustomerPresence();
      presence = presence.withSnapshot(7, {'a'}, const []);
      presence = presence.withSnapshot(6, {}, const []);
      expect(presence.isOnline('a'), isTrue);
    });
  });

  group('onlineFirst', () {
    test('lists online customers first, each group newest first', () {
      final presence = const CustomerPresence().withSnapshot(1, {'u3'}, []);
      final channels = [
        _channel('1', 'u1', '2026-10-10T09:00:00Z'),
        _channel('2', 'u2', '2026-10-10T08:00:00Z'),
        _channel('3', 'u3', '2026-10-10T07:00:00Z'),
      ];
      final ordered = onlineFirst(channels, presence);
      expect(ordered.map((c) => c.id).toList(), ['3', '1', '2']);
      expect(onlineLead(ordered, presence), 1);
    });
  });
}
