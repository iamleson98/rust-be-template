import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:forui/forui.dart';
import 'package:go_router/go_router.dart';

import '../../core/audio/sound_service.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/design.dart';
import '../../core/duty_mode.dart';
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
          decoration: const InputDecoration(
            hintText: 'https://api.datxevui.com',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Hủy'),
          ),
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
              trailing: mode == current ? const Icon(Icons.check) : null,
              onTap: () => Navigator.pop(context, mode),
            ),
        ],
      ),
    );
    if (result != null) {
      await ref.read(themeModeProvider.notifier).set(result);
    }
  }

  Future<void> _logout() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Đăng xuất?'),
        content: const Text('Bạn sẽ không nhận được thông báo hỗ trợ nữa.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Ở lại'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Đăng xuất'),
          ),
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
    final dutySupported = ref.watch(dutyModeSupportedProvider).value ?? false;
    final duty = ref.watch(dutyModeProvider);

    final modeLabel = switch (mode) {
      ThemeMode.light => 'Sáng',
      ThemeMode.dark => 'Tối',
      ThemeMode.system => 'Theo hệ thống',
    };

    return Scaffold(
      backgroundColor: theme.colors.background,
      body: SafeArea(
        bottom: false,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 12, 4, 12),
              child: Text(
                'Cài đặt',
                style: theme.typography.display.xl2.copyWith(
                  fontWeight: FontWeight.w700,
                  letterSpacing: -0.6,
                  color: theme.colors.foreground,
                ),
              ),
            ),

            // ── Profile ──────────────────────────────────────────────
            _Group(
              children: [
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    children: [
                      AgentAvatar(
                        name: user?.name ?? '?',
                        imageUrl: user?.avatarUrl,
                        size: 52,
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              user?.name ?? '—',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: theme.typography.body.lg.copyWith(
                                fontWeight: FontWeight.w700,
                                color: theme.colors.foreground,
                              ),
                            ),
                            const SizedBox(height: 1),
                            Text(
                              [
                                user?.isAdmin == true
                                    ? 'Quản trị viên'
                                    : 'Nhân viên hỗ trợ',
                                if ((user?.email ?? '').isNotEmpty) user!.email,
                              ].join(' · '),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: theme.typography.body.sm.copyWith(
                                color: theme.colors.mutedForeground,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),

            // ── Connection ───────────────────────────────────────────
            _sectionLabel(theme, 'Kết nối'),
            _Group(
              children: [
                _tile(
                  icon: FLucideIcons.server,
                  title: 'Máy chủ',
                  details: cfg.baseUrl,
                  onTap: _editServer,
                ),
                _tile(
                  icon: FLucideIcons.activity,
                  title: 'Kiểm tra mạng cuộc gọi',
                  details: 'DNS, TCP/TLS 443, STUN — chẩn đoán mạng công ty',
                  onTap: () => context.push('/settings/call-doctor'),
                ),
                _tile(
                  icon: FLucideIcons.sunMoon,
                  title: 'Giao diện',
                  details: modeLabel,
                  onTap: _pickTheme,
                ),
              ],
            ),

            // ── Alerts ───────────────────────────────────────────────
            _sectionLabel(theme, 'Thông báo'),
            _Group(
              children: [
                _switchTile(
                  theme: theme,
                  icon: FLucideIcons.bell,
                  value: alerts,
                  onChange: (v) =>
                      ref.read(alertsEnabledProvider.notifier).set(v),
                  label: 'Thông báo',
                  description: 'Khi có tin nhắn hoặc cuộc gọi mới',
                ),
                _switchTile(
                  theme: theme,
                  icon: FLucideIcons.volume2,
                  value: sound,
                  onChange: (v) =>
                      ref.read(soundEnabledProvider.notifier).set(v),
                  label: 'Âm thanh',
                  description: 'Phát âm báo khi có tin nhắn và cuộc gọi',
                ),
                _switchTile(
                  theme: theme,
                  icon: FLucideIcons.smartphone,
                  value: vibrate,
                  onChange: (v) =>
                      ref.read(vibrateEnabledProvider.notifier).set(v),
                  label: 'Rung',
                  description: 'Rung khi nhận tin nhắn và cuộc gọi',
                ),
                if (dutySupported)
                  _switchTile(
                    theme: theme,
                    icon: FLucideIcons.phoneCall,
                    value: duty,
                    onChange: (v) => ref.read(dutyModeProvider.notifier).set(v),
                    label: 'Chế độ trực',
                    description: 'Giữ kết nối khi đóng app — điện thoại vẫn reng khi có cuộc gọi mới',
                  ),
                _tile(
                  icon: FLucideIcons.play,
                  title: 'Nghe thử âm báo',
                  onTap: () =>
                      unawaited(ref.read(soundServiceProvider).preview()),
                ),
              ],
            ),

            // ── Sign out ─────────────────────────────────────────────
            const SizedBox(height: 24),
            _Group(
              children: [
                _tile(
                  icon: FLucideIcons.logOut,
                  title: 'Đăng xuất',
                  onTap: _logout,
                  destructive: true,
                ),
              ],
            ),
            const SizedBox(height: 16),
            Text(
              'DatXeVui · v0.1.0',
              textAlign: TextAlign.center,
              style: theme.typography.body.xs.copyWith(
                color: theme.colors.mutedForeground,
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Quiet group label above a settings section.
  Widget _sectionLabel(FThemeData theme, String text) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 20, 4, 8),
      child: Text(
        text,
        style: theme.typography.body.sm.copyWith(
          color: theme.colors.mutedForeground,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  /// One switch row: icon, title + a line of explanation, the toggle at
  /// the end (where the thumb expects it).
  Widget _switchTile({
    required FThemeData theme,
    required IconData icon,
    required bool value,
    required ValueChanged<bool> onChange,
    required String label,
    required String description,
  }) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
      child: Row(
        children: [
          _RowIcon(icon: icon),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: theme.typography.body.md.copyWith(
                    color: theme.colors.foreground,
                  ),
                ),
                const SizedBox(height: 1),
                Text(
                  description,
                  style: theme.typography.body.xs.copyWith(
                    color: theme.colors.mutedForeground,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          FSwitch(value: value, onChange: onChange, semanticsLabel: label),
        ],
      ),
    );
  }

  /// One tappable row: icon, title (and an optional detail line), chevron.
  Widget _tile({
    required IconData icon,
    required String title,
    required VoidCallback onTap,
    String? details,
    bool destructive = false,
  }) {
    final theme = context.theme;
    final color = destructive
        ? theme.colors.destructive
        : theme.colors.foreground;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
        child: Row(
          children: [
            _RowIcon(icon: icon, destructive: destructive),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: theme.typography.body.md.copyWith(color: color),
                  ),
                  if (details != null) ...[
                    const SizedBox(height: 1),
                    Text(
                      details,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.typography.body.xs.copyWith(
                        color: theme.colors.mutedForeground,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            if (!destructive)
              Icon(
                FLucideIcons.chevronRight,
                size: 16,
                color: theme.colors.mutedForeground,
              ),
          ],
        ),
      ),
    );
  }
}

/// A white card holding a run of rows, hairlines between them (iOS
/// grouped-list style).
class _Group extends StatelessWidget {
  const _Group({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final theme = context.theme;
    return Container(
      decoration: BoxDecoration(
        color: theme.colors.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: theme.colors.border),
        boxShadow: AppShadow.soft,
      ),
      clipBehavior: Clip.antiAlias,
      child: Material(
        type: MaterialType.transparency,
        child: Column(
          children: [
            for (final (i, child) in children.indexed) ...[
              if (i > 0)
                Divider(
                  height: 1,
                  thickness: 1,
                  indent: 58,
                  color: theme.colors.border,
                ),
              child,
            ],
          ],
        ),
      ),
    );
  }
}

/// The small tinted square that leads a settings row.
class _RowIcon extends StatelessWidget {
  const _RowIcon({required this.icon, this.destructive = false});

  final IconData icon;
  final bool destructive;

  @override
  Widget build(BuildContext context) {
    final theme = context.theme;
    final color = destructive ? theme.colors.destructive : theme.colors.primary;
    return Container(
      width: 32,
      height: 32,
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(9),
      ),
      child: Icon(icon, size: 17, color: color),
    );
  }
}
