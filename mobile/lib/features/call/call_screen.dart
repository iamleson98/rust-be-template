import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:forui/forui.dart';

import '../../shared/widgets.dart';
import 'call_controller.dart';
import 'call_state.dart';

/// Full-screen call UI covering every state: ringing (in/out), connecting,
/// active with a duration timer, and the brief "ended" flash.
///
/// The screen is intentionally audio-first — the production flow is a
/// customer tapping the call button on the web widget; remote audio plays
/// through the earpiece/loudspeaker (see [CallEngine]).
class CallScreen extends ConsumerStatefulWidget {
  const CallScreen({super.key});

  @override
  ConsumerState<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends ConsumerState<CallScreen> {
  Timer? _ticker;
  Duration _elapsed = Duration.zero;

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  void _startTicker(DateTime startedAt) {
    _ticker?.cancel();
    _elapsed = DateTime.now().difference(startedAt);
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) {
        setState(() => _elapsed = DateTime.now().difference(startedAt));
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final call = ref.watch(callUiStateProvider);
    final theme = context.theme;

    if (call.status == CallStatus.active && _ticker == null) {
      _startTicker(call.startedAt ?? DateTime.now());
    } else if (call.status != CallStatus.active) {
      _ticker?.cancel();
      _ticker = null;
    }

    final status = _statusText(call);

    return Scaffold(
      backgroundColor: theme.colors.background,
      body: SafeArea(
        child: Column(
          children: [
            const Spacer(flex: 2),
            PulsingAvatar(
              pulse: call.status == CallStatus.incoming ||
                  call.status == CallStatus.calling,
              child: AgentAvatar(name: call.peerName, size: 112),
            ),
            const SizedBox(height: 24),
            Text(
              call.peerName.isEmpty ? 'Khách hàng' : call.peerName,
              style: theme.typography.display.xl.copyWith(
                fontWeight: FontWeight.w700,
                color: theme.colors.foreground,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              status,
              style: theme.typography.body.md.copyWith(
                color: call.status == CallStatus.active
                    ? theme.colors.primary
                    : theme.colors.mutedForeground,
              ),
            ),
            if (call.status == CallStatus.active) ...[
              const SizedBox(height: 4),
              Text(
                formatCallDuration(_elapsed),
                style: theme.typography.display.lg.copyWith(
                  fontFeatures: [const FontFeature.tabularFigures()],
                  color: theme.colors.foreground,
                ),
              ),
            ],
            if (call.error != null) ...[
              const SizedBox(height: 12),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: FAlert(
                  variant: FAlertVariant.destructive,
                  title: Text(call.error!),
                ),
              ),
            ],
            const Spacer(flex: 3),
            _controls(context, call),
            const SizedBox(height: 48),
          ],
        ),
      ),
    );
  }

  String _statusText(CallUiState call) {
    switch (call.status) {
      case CallStatus.incoming:
        return 'Cuộc gọi đến…';
      case CallStatus.calling:
        return 'Đang đổ chuông…';
      case CallStatus.connecting:
        return 'Đang kết nối…';
      case CallStatus.active:
        return 'Đang trò chuyện';
      case CallStatus.ended:
        return call.endedReason ?? 'Cuộc gọi đã kết thúc';
      case CallStatus.idle:
        return '';
    }
  }

  Widget _controls(BuildContext context, CallUiState call) {
    switch (call.status) {
      case CallStatus.incoming:
        return Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _roundButton(
              context,
              icon: FLucideIcons.phoneOff,
              background: context.theme.colors.destructive,
              foreground: context.theme.colors.destructiveForeground,
              semantics: 'Từ chối',
              onTap: () =>
                  ref.read(callUiStateProvider.notifier).decline(),
            ),
            const SizedBox(width: 40),
            _roundButton(
              context,
              icon: FLucideIcons.phone,
              background: const Color(0xFF22C55E),
              foreground: Colors.white,
              pulse: true,
              semantics: 'Nghe máy',
              onTap: () =>
                  ref.read(callUiStateProvider.notifier).accept(),
            ),
          ],
        );
      case CallStatus.calling:
      case CallStatus.connecting:
      case CallStatus.active:
        return Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _roundButton(
              context,
              icon: call.micEnabled ? FLucideIcons.mic : FLucideIcons.micOff,
              background: call.micEnabled
                  ? context.theme.colors.muted
                  : context.theme.colors.primary,
              foreground: call.micEnabled
                  ? context.theme.colors.foreground
                  : context.theme.colors.primaryForeground,
              semantics: 'Bật/tắt micro',
              onTap: () =>
                  ref.read(callUiStateProvider.notifier).toggleMic(),
            ),
            const SizedBox(width: 28),
            _roundButton(
              context,
              icon: FLucideIcons.phoneOff,
              background: context.theme.colors.destructive,
              foreground: context.theme.colors.destructiveForeground,
              semantics: 'Kết thúc cuộc gọi',
              onTap: () => ref.read(callUiStateProvider.notifier).hangup(),
            ),
            const SizedBox(width: 28),
            _roundButton(
              context,
              icon: call.speakerOn
                  ? FLucideIcons.volume2
                  : FLucideIcons.volumeX,
              background: call.speakerOn
                  ? context.theme.colors.primary
                  : context.theme.colors.muted,
              foreground: call.speakerOn
                  ? context.theme.colors.primaryForeground
                  : context.theme.colors.foreground,
              semantics: 'Loa ngoài',
              onTap: () => ref
                  .read(callUiStateProvider.notifier)
                  .toggleSpeaker(),
            ),
          ],
        );
      case CallStatus.ended:
      case CallStatus.idle:
        return const SizedBox.shrink();
    }
  }

  Widget _roundButton(
    BuildContext context, {
    required IconData icon,
    required Color background,
    required Color foreground,
    required String semantics,
    required VoidCallback onTap,
    bool pulse = false,
  }) {
    return Semantics(
      label: semantics,
      button: true,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          width: 64,
          height: 64,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: background,
            boxShadow: [
              BoxShadow(
                color: background.withValues(alpha: 0.35),
                blurRadius: pulse ? 24 : 12,
                spreadRadius: pulse ? 3 : 0,
              ),
            ],
          ),
          child: Icon(icon, color: foreground, size: 26),
        ),
      ),
    );
  }
}
