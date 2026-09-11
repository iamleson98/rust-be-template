import 'dart:async';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:forui/forui.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import 'call_signaling.dart';
import 'call_state.dart' show defaultIceServers;

/// Call-connectivity doctor: tests, from THIS device and THIS network,
/// every path a WebRTC call could use — the exact list the server
/// pushed over `/ws-call` (`registered.iceServers`), plus the public
/// STUN fallback.
///
/// Why this exists: on office/corporate networks, calls sit on
/// "connecting" because the firewall silently drops UDP and non-443
/// TCP; the only viable path is TURN-over-TLS on TCP 443
/// (`turns:turn.datxevui.com:443?transport=tcp`). The server-side path
/// can be perfectly healthy while the LOCAL network blocks it — and
/// until now the app gave no way to tell those apart. Each probe here
/// replicates what libwebrtc's ICE layer does for that candidate:
///
///   1. DNS resolve
///   2. TCP connect (NAT/firewall reachability)
///   3. for `turns:` — TLS handshake INCLUDING certificate validation
///      against the platform trust store (what libwebrtc enforces too)
///   4. STUN Allocate — a TURN server must answer 401 + REALM + NONCE
///      before credentials are even tried
///
/// The verdict line tells the user (or their IT department) exactly
/// what to do: which host/port must be reachable for calls to work.

// ── STUN wire format helpers ──────────────────────────────────────

const int _stunMagic = 0x2112A442;
const int _allocateRequest = 0x0003;
const int _allocateError = 0x0113;
const int _bindingRequest = 0x0001;

Uint8List _stunRequest(int type, Uint8List txid) {
  final b = ByteData(20);
  b.setUint16(0, type, Endian.big);
  b.setUint16(2, 0, Endian.big); // no attributes
  b.setUint32(4, _stunMagic, Endian.big);
  final bytes = b.buffer.asUint8List();
  bytes.setAll(8, txid);
  return bytes;
}

Uint8List _randomTxid() {
  final r = Random.secure();
  return Uint8List.fromList(List.generate(12, (_) => r.nextInt(256)));
}

/// Parsed view of the STUN response: type + whether the transaction id
/// matches (proves the bytes came from OUR request, not firewall noise).
({int type, bool txMatch})? _parseStun(Uint8List data, Uint8List txid) {
  if (data.length < 20) return null;
  final b = ByteData.sublistView(data);
  if (b.getUint32(4, Endian.big) != _stunMagic) return null;
  final txMatch = _bytesEqual(data.sublist(8, 20), txid);
  return (type: b.getUint16(0, Endian.big), txMatch: txMatch);
}

/// Private-by-design (leading underscore): the Flutter foundation
/// library exports a `listEquals` of its own — a local top-level with
/// the same name would shadow it silently, so this one keeps a
/// distinct, file-private name.
bool _bytesEqual(List<int> a, List<int> b) {
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}

// ── ICE URL parsing ───────────────────────────────────────────────

class _Endpoint {
  final String raw;
  final String scheme; // turns | turn | stun
  final String host;
  final int port;
  final String transport; // tcp | udp

  _Endpoint(this.raw, this.scheme, this.host, this.port, this.transport);
}

_Endpoint? _parseIceUrl(String url) {
  final m = RegExp(
    r'^(turns|turn|stun):([^?:\s]+)(?::(\d+))?(?:\?([^#\s]*))?$',
    caseSensitive: false,
  ).firstMatch(url.trim());
  if (m == null) return null;
  final scheme = m.group(1)!.toLowerCase();
  final host = m.group(2)!;
  final port = int.tryParse(m.group(3) ?? '') ?? _defaultPort(scheme);
  var transport = scheme == 'turns' ? 'tcp' : 'udp';
  final query = m.group(4);
  if (query != null) {
    for (final kv in query.split('&')) {
      final eq = kv.indexOf('=');
      if (eq > 0 && kv.substring(0, eq).toLowerCase() == 'transport') {
        transport = kv.substring(eq + 1).toLowerCase();
      }
    }
  }
  return _Endpoint(url, scheme, host, port, transport);
}

int _defaultPort(String scheme) => switch (scheme) {
      'turns' => 5349,
      _ => 3478,
    };

// ── Probe engine ─────────────────────────────────────────────────

enum ProbeStatus { waiting, running, ok, fail }

/// File-private result record (the analyzer forbids private types in
/// public APIs — `_Endpoint` is an implementation detail).
class _ProbeResult {
  final _Endpoint endpoint;
  ProbeStatus status = ProbeStatus.waiting;
  String detail = '';
  int elapsedMs = 0;

  _ProbeResult(this.endpoint);
}

/// Runs one probe for [e]; returns a short human detail string, throws
/// on failure. (Elapsed-time measurement is the caller's job —
/// `_runAll` times the whole sequence for the UI.)
Future<String> _probe(_Endpoint e) async {
  final txid = _randomTxid();

  if (e.transport == 'tcp') {
    if (e.scheme == 'turns') {
      // TLS: validates the certificate chain exactly like libwebrtc's
      // TURN-TLS client (badAddress → HandshakeException on the phone).
      final socket = await SecureSocket.connect(
        e.host,
        e.port,
        timeout: const Duration(seconds: 8),
      );
      try {
        socket.add(_stunRequest(_allocateRequest, txid));
        final data = await socket.first
            .timeout(const Duration(seconds: 5));
        final parsed = _parseStun(data, txid);
        if (parsed == null || !parsed.txMatch) {
          throw const SocketException('đáp ứng không phải STUN');
        }
        if (parsed.type == _allocateError) {
          return 'TLS + TURN OK (máy chủ yêu cầu xác thực — đúng như mong đợi)';
        }
        return 'TLS OK, STUN type=0x${parsed.type.toRadixString(16)}';
      } finally {
        socket.destroy();
      }
    }

    // Plain TURN / STUN over TCP.
    final socket = await Socket.connect(
      e.host,
      e.port,
      timeout: const Duration(seconds: 8),
    );
    try {
      socket.add(_stunRequest(
        e.scheme == 'stun' ? _bindingRequest : _allocateRequest,
        txid,
      ));
      final data =
          await socket.first.timeout(const Duration(seconds: 5));
      final parsed = _parseStun(data, txid);
      if (parsed == null || !parsed.txMatch) {
        throw const SocketException('đáp ứng không phải STUN');
      }
      return 'TCP OK, STUN trả lời';
    } finally {
      socket.destroy();
    }
  }

  // UDP — best effort; silently dropped packets are the NORM on
  // corporate networks, which is exactly what this screen must show.
  final socket = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0)
      .timeout(const Duration(seconds: 5));
  final completer = Completer<void>();
  // RawDatagramSocket is a single-subscription stream — exactly ONE
  // listener, registered before anything else touches the socket.
  final sub = socket.listen((event) {
    if (event == RawSocketEvent.read && !completer.isCompleted) {
      completer.complete();
    }
  });
  try {
    // Resolve the hostname first — RawDatagramSocket.send needs an
    // InternetAddress, and the constructor only accepts IP literals.
    final addrs = await InternetAddress.lookup(e.host)
        .timeout(const Duration(seconds: 5));
    if (addrs.isEmpty) {
      throw const SocketException('không phân giải được tên miền');
    }
    final req = _stunRequest(
      e.scheme == 'stun' ? _bindingRequest : _allocateRequest,
      txid,
    );
    socket.send(req, addrs.first, e.port);
    await completer.future.timeout(const Duration(seconds: 4), onTimeout: () {
      throw const SocketException('hết thời gian chờ (mạng có thể chặn UDP)');
    });
    final dg = socket.receive();
    if (dg == null) {
      throw const SocketException('không nhận được gói tin');
    }
    final parsed = _parseStun(dg.data, txid);
    if (parsed == null || !parsed.txMatch) {
      throw const SocketException('đáp ứng không phải STUN');
    }
    return 'UDP OK, STUN trả lời';
  } finally {
    unawaited(sub.cancel());
    socket.close();
  }
}

// ── Screen ────────────────────────────────────────────────────────

class CallNetworkDoctorScreen extends ConsumerStatefulWidget {
  const CallNetworkDoctorScreen({super.key});

  @override
  ConsumerState<CallNetworkDoctorScreen> createState() =>
      _CallNetworkDoctorScreenState();
}

class _CallNetworkDoctorScreenState
    extends ConsumerState<CallNetworkDoctorScreen> {
  final List<_ProbeResult> _results = [];
  bool _running = false;

  List<_ProbeResult> get _usable => _results
      .where((r) => r.status == ProbeStatus.ok && r.endpoint.scheme != 'stun')
      .toList(growable: false);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _runAll());
  }

  Future<void> _runAll() async {
    if (_running) return;
    setState(() {
      _running = true;
      _results.clear();
    });

    final sig = ref.read(callSignalingProvider);
    // De-duplicated URL list pushed by the server or fallback default STUN.
    final pushedUrls = <String>{};
    final configuredServers = (sig?.iceServers.isNotEmpty ?? false)
        ? sig!.iceServers
        : defaultIceServers;
    for (final server in configuredServers) {
      final rawUrls = server['urls'];
      if (rawUrls is List) {
        for (final url in rawUrls) {
          if (url is String) pushedUrls.add(url);
        }
      } else if (rawUrls is String) {
        pushedUrls.add(rawUrls);
      }
    }

    final endpoints = <_Endpoint>[];
    for (final url in pushedUrls) {
      final e = _parseIceUrl(url);
      if (e != null) endpoints.add(e);
    }

    setState(() {
      for (final e in endpoints) {
        _results.add(_ProbeResult(e));
      }
    });

    for (final result in _results) {
      setState(() => result.status = ProbeStatus.running);
      final watch = Stopwatch()..start();
      try {
        result.detail = await _probe(result.endpoint);
        result.status = ProbeStatus.ok;
      } catch (err) {
        result.detail = _errText(err);
        result.status = ProbeStatus.fail;
      }
      result.elapsedMs = watch.elapsedMilliseconds;
      if (mounted) setState(() {});
      // Small gap so the UI reads as a sequence, not a flash.
      await Future<void>.delayed(const Duration(milliseconds: 120));
    }

    if (mounted) setState(() => _running = false);
  }

  String _errText(Object err) {
    if (err is SocketException) {
      final m = err.message.toLowerCase();
      if (m.contains('timed out') ||
          m.contains('hết thời gian') ||
          m.contains('timeout')) {
        return 'Hết thời gian chờ — mạng có thể đang chặn';
      }
      if (m.contains('failed host lookup') ||
          m.contains('name or service not known') ||
          m.contains('không phân giải')) {
        return 'Không phân giải được tên miền (DNS)';
      }
      return err.message;
    }
    if (err is HandshakeException) {
      return 'TLS thất bại: ${err.message.split('\n').first}';
    }
    if (err is TimeoutException) {
      return 'Hết thời gian chờ';
    }
    return err.toString();
  }

  @override
  Widget build(BuildContext context) {
    final theme = context.theme;
    final sig = ref.watch(callSignalingProvider);
    final hasPushedList = (sig?.iceServers ?? const []).isNotEmpty;

    return Scaffold(
      backgroundColor: theme.colors.background,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            // Header — back + title (matches the chat room's header
            // pattern: circular ghost icon button + bold text).
            Row(
              children: [
                Semantics(
                  button: true,
                  child: GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTap: () => context.pop(),
                    child: SizedBox(
                      width: 44,
                      height: 44,
                      child: Icon(
                        FLucideIcons.chevronLeft,
                        size: 21,
                        color: theme.colors.foreground,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 4),
                Text(
                  'Kiểm tra mạng cuộc gọi',
                  style: theme.typography.display.lg.copyWith(
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.3,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            _introCard(theme, hasPushedList),
            const SizedBox(height: 12),
            for (final r in _results) ...[
              _probeTile(theme, r),
              const SizedBox(height: 8),
            ],
            if (!_running && _results.isNotEmpty) ...[
              const SizedBox(height: 8),
              _verdictCard(theme),
            ],
            const SizedBox(height: 24),
            IgnorePointer(
              // IgnorePointer (not onPress: null) keeps this independent
              // of the FButton API's disabled-state contract.
              ignoring: _running,
              child: FButton(
                prefix: _running
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(FLucideIcons.refreshCw),
                onPress: () => unawaited(_runAll()),
                child: Text(_running ? 'Đang kiểm tra…' : 'Kiểm tra lại'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _introCard(FThemeData theme, bool hasPushedList) {
    final ok = hasPushedList;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: ok
            ? theme.colors.primary.withValues(alpha: 0.08)
            : Colors.amber.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: ok
              ? theme.colors.primary.withValues(alpha: 0.25)
              : Colors.amber.withValues(alpha: 0.4),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            ok ? FLucideIcons.server : FLucideIcons.triangleAlert,
            color: ok ? theme.colors.primary : Colors.amber.shade800,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  ok
                      ? 'Đang kiểm tra đường kết nối do máy chủ đẩy xuống'
                      : 'Máy chủ chưa đẩy cấu hình TURN',
                  style: theme.typography.body.md.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  ok
                      ? 'Mỗi đường dẫn được thử đúng như cuộc gọi thật: DNS → TCP/TLS → STUN. Nếu mọi đường đều lỗi trên mạng này, cuộc gọi sẽ kẹt ở "đang kết nối".'
                      : 'Đang thử danh sách STUN công khai (Google). Với mạng công ty, hãy kiểm tra lại kết nối tới máy chủ.',
                  style: theme.typography.body.sm.copyWith(
                    color: theme.colors.mutedForeground,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _probeTile(FThemeData theme, _ProbeResult r) {
    final (color, icon, label) = switch (r.status) {
      ProbeStatus.waiting => (theme.colors.mutedForeground, FLucideIcons.hourglass, 'Chờ'),
      ProbeStatus.running => (theme.colors.primary, FLucideIcons.loader, 'Đang kiểm tra…'),
      ProbeStatus.ok => (Colors.green.shade600, FLucideIcons.circleCheck, 'Hoạt động'),
      ProbeStatus.fail => (Colors.red.shade600, FLucideIcons.circleX, 'Không kết nối được'),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: theme.colors.card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: theme.colors.border),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 22),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  r.endpoint.raw,
                  style: theme.typography.body.md.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  r.status == ProbeStatus.waiting || r.status == ProbeStatus.running
                      ? label
                      : '$label — ${r.detail}'
                          '${r.elapsedMs > 0 ? ' (${r.elapsedMs} ms)' : ''}',
                  style: theme.typography.body.sm.copyWith(
                    color: r.status == ProbeStatus.fail
                        ? Colors.red.shade700
                        : theme.colors.mutedForeground,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _verdictCard(FThemeData theme) {
    final usable = _usable;
    final tlsOk = usable.any((r) => r.endpoint.scheme == 'turns');
    final tcpOk = usable.any((r) =>
        r.endpoint.scheme == 'turn' && r.endpoint.transport == 'tcp');
    final udpOk = usable.isNotEmpty && !tlsOk && !tcpOk;

    final (title, body, color, icon) = tlsOk || tcpOk
        ? (
            tlsOk
                ? 'Mạng này gọi được'
                : 'Mạng này gọi được (TCP)',
            tlsOk
                ? 'Đường TURN qua TLS trên cổng 443 hoạt động — đây chính là đường cuộc gọi sẽ dùng. Nếu cuộc gọi vẫn không kết nối được, lỗi nằm ở khâu khác (thử lại, hoặc kiểm tra tai nghe/micro).'
                : 'Đường TURN qua TCP hoạt động. Nếu cuộc gọi vẫn kẹt, có thể mạng chỉ chặn UDP — vẫn ổn.',
            Colors.green.shade600,
            FLucideIcons.badgeCheck,
          )
        : udpOk
            ? (
                'Chỉ có UDP hoạt động',
                'Mạng này cho phép UDP. Nếu cuộc gọi kẹt ở "đang kết nối", hãy chạy lại kiểm tra ở thời điểm lỗi xảy ra.',
                Colors.amber.shade700,
                FLucideIcons.info,
              )
            : (
                'Mạng này đang chặn cuộc gọi',
                'Không có đường TURN/STUN nào qua được. Với mạng công ty, yêu cầu IT mở kết nối TCP 443 tới ${_results.isNotEmpty ? _results.first.endpoint.host : 'máy chủ TURN'} (giao diện TLS). Không có đường này, cuộc gọi không thể kết nối.',
                Colors.red.shade600,
                FLucideIcons.octagonX,
              );

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: theme.typography.body.md.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  body,
                  style: theme.typography.body.sm.copyWith(
                    color: theme.colors.mutedForeground,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
