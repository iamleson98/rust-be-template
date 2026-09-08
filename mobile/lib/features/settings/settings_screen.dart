import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:forui/forui.dart';

import '../../core/audio/sound_service.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/env.dart';
import '../../core/router.dart';
import '../../core/settings.dart';
import '../../core/theme_mode.dart';
import '../../shared/widgets.dart';

/// Profile, server address, theme, alerts, and logout.
class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  Future<void> _editServer() async {
    final cfg = ref.read(appConfigProvider);
    final controller = TextEditingController(text: cfg.baseUrl);
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Địa chỉ máy chủ'),
        content: TextField(
          controller: controller,
          autofocus: true,
          keyboardType: TextInputType.url,
          decoration: const InputDecoration(hintText: 'https://api.datxevui.com'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Hủy')),
          TextButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Lưu'),
          ),
        ],
      ),
    );
    if (result != null && result.isNotEmpty && result != cfg.baseUrl) {
      await ref.read(appConfigProvider.notifier).setServerUrl(result);
      // Tokens belong to the old origin — start fresh.
      await ref.read(authControllerProvider.notifier).forceLocalLogout();
      if (mounted) ref.read(routerProvider).go('/login');
    }
  }

  Future<void> _pickTheme() async {
    final current = ref.read(themeModeProvider);
    final modes = [
      (ThemeMode.system, 'Theo hệ thống'),
      (ThemeMode.light, 'Sáng'),
      (ThemeMode.dark, 'Tối'),
    ];
    final result = await showDialog<ThemeMode>(
      context: context,
      builder: (context) => SimpleDialog(
        title: const Text('Giao diện'),
        children: [
          // Plain tiles + a check mark (RadioListTile's groupValue/onChanged
          // are deprecated on current Flutter).
          for (final (mode, label) in modes)
            ListTile(
              title: Text(label),
              trailing: mode == current
                  ? const Icon(Icons.check)
                  : null,
              onTap: () => Navigator.pop(context, mode),
            ),
        ],
      ),
    );
    if (result != null) {
      unawaited(ref.read(themeModeProvider.notifier).set(result));
    }
  }

  Future<void> _logout() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Đăng xuất?'),
        content: const Text('Bạn sẽ không nhận được thông báo hỗ trợ nữa.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Ở lại')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Đăng xuất')),
        ],
      ),
    );
    if (confirmed != true) return;
    await ref.read(authControllerProvider.notifier).logout();
    if (mounted) ref.read(routerProvider).go('/login');
  }

  @override
  Widget build(BuildContext context) {
    final theme = context.theme;
    final user = ref.watch(authControllerProvider).user;
    final cfg = ref.watch(appConfigProvider);
    final mode = ref.watch(themeModeProvider);
    final alerts = ref.watch(alertsEnabledProvider);
    final sound = ref.watch(soundEnabledProvider);
    final vibrate = ref.watch(vibrateEnabledProvider);

    final modeLabel = switch (mode) {
      ThemeMode.light => 'Sáng',
      ThemeMode.dark => 'Tối',
      ThemeMode.system => 'Theo hệ thống',
    };

    return FScaffold(
      header: FHeader(title: const Text('Cài đặt')),
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          // ── Profile ────────────────────────────────────────────────
          FCard(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  AgentAvatar(
                    name: user?.name ?? '?',
                    imageUrl: user?.avatarUrl,
                    size: 56,
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          user?.name ?? '—',
                          style: theme.typography.display.lg.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          user?.email ?? '',
                          style: theme.typography.body.sm
                              .copyWith(color: theme.colors.mutedForeground),
                        ),
                        const SizedBox(height: 8),
                        FBadge(
                          variant: user?.isAdmin == true
                              ? FBadgeVariant.primary
                              : FBadgeVariant.secondary,
                          child: Text(
                            user?.isAdmin == true ? 'Quản trị viên' : 'Nhân viên hỗ trợ',
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),

          // ── Connection ─────────────────────────────────────────────
          _tile(
            icon: FLucideIcons.wifi,
            title: 'Máy chủ',
            details: cfg.baseUrl,
            onTap: _editServer,
          ),
          _tile(
            icon: FLucideIcons.settings,
            title: 'Giao diện',
            details: modeLabel,
            onTap: _pickTheme,
          ),
          // ── Alerts ────────────────────────────────────────────────
          FCard(
            child: Column(
              children: [
                FSwitch(
                  value: alerts,
                  onChange: (v) =>
                      ref.read(alertsEnabledProvider.notifier).set(v),
                  label: const Text('Thông báo'),
                  description: const Text(
                    'Hiện thông báo khi có tin nhắn hoặc cuộc gọi mới',
                  ),
                ),
                const FDivider(),
                FSwitch(
                  value: sound && alerts,
                  onChange: (v) =>
                      ref.read(soundEnabledProvider.notifier).set(v),
                  label: const Text('Âm thanh'),
                  description: const Text(
                    'Phát nhạc chuông và âm báo thật (Google AOSP + Jitsi)',
                  ),
                ),
                const FDivider(),
                FSwitch(
                  value: vibrate && alerts,
                  onChange: (v) =>
                      ref.read(vibrateEnabledProvider.notifier).set(v),
                  label: const Text('Rung'),
                  description: const Text(
                    'Rung thiết bị khi nhận tin nhắn và cuộc gọi',
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          FButton(
            variant: FButtonVariant.outline,
            prefix: const Icon(FLucideIcons.volume2),
            onPress: () => unawaited(
              ref.read(soundServiceProvider).preview(),
            ),
            child: const Text('Nghe thử âm báo'),
          ),
          const SizedBox(height: 24),

          // ── Sign out ───────────────────────────────────────────────
          FButton(
            variant: FButtonVariant.destructive,
            prefix: const Icon(FLucideIcons.logOut),
            onPress: _logout,
            child: const Text('Đăng xuất'),
          ),
          const SizedBox(height: 16),
          Text(
            'DatXeVui Tổng đài • v0.1.0',
            textAlign: TextAlign.center,
            style: theme.typography.body.sm
                .copyWith(color: theme.colors.mutedForeground),
          ),
        ],
      ),
    );
  }

  Widget _tile({
    required IconData icon,
    required String title,
    required String details,
    required VoidCallback onTap,
  }) {
    final theme = context.theme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: FCard(
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: [
                Icon(icon, size: 18, color: theme.colors.primary),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title, style: theme.typography.body.md),
                      const SizedBox(height: 2),
                      Text(
                        details,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.typography.body.sm.copyWith(
                          color: theme.colors.mutedForeground,
                        ),
                      ),
                    ],
                  ),
                ),
                Icon(FLucideIcons.chevronRight,
                    size: 16, color: theme.colors.mutedForeground),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
