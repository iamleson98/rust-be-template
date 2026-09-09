import 'package:datxevui_support/core/env.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('AppConfig.wsUri', () {
    test('preserves the Android emulator backend port', () {
      const config = AppConfig(baseUrl: 'http://10.0.2.2:8080');

      final uri = config.wsUri('/ws', {'token': 'access-token'});

      expect(uri.toString(), 'ws://10.0.2.2:8080/ws?token=access-token');
    });

    test('uses wss and preserves a base path prefix', () {
      const config = AppConfig(baseUrl: 'https://example.com/api');

      final uri = config.wsUri('/ws-call');

      expect(uri.toString(), 'wss://example.com/api/ws-call');
    });
  });
}