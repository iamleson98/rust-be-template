import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:forui/forui.dart';

import '../../core/design.dart';
import '../../core/auth/auth_controller.dart';
import '../../shared/widgets.dart';
import '../chat/models.dart';
import 'presence_controller.dart';

/// Team board: who's online, who's on a call, chat load, and whether the
/// NullClaw bot is currently owning support.
///
/// Gradient stat cards up top, clean staff rows below.
class TeamScreen extends ConsumerWidget {
  const TeamScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final snapshot = ref.watch(staffPresenceProvider);
    final myId = ref.watch(authControllerProvider).user?.id;

    return Scaffold(
      backgroundColor: context.theme.colors.background,
      body: Column(
        children: [
          _ScreenTitle(theme: context.theme, title: 'Đội ngũ'),
          Expanded(
            child: snapshot == null
                ? const Center(child: CircularProgressIndicator())
                : RefreshIndicator(
                    onRefresh: () =>
                        ref.read(staffPresenceProvider.notifier).refetch(),
                    child: ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.fromLTRB(12, 4, 12, 110),
                      children: [
                        if (snapshot.botActive)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 12),
                            child: FAlert(
                              variant: FAlertVariant.primary,
                              icon: const Icon(FLucideIcons.sparkles),
                              title: const Text('Bot đang trực'),
                              subtitle: const Text(
                                'Không có nhân viên online — NullClaw đang hỗ trợ khách.',
                              ),
                            ),
                          ),
                        _SummaryRow(snapshot: snapshot),
                        const SizedBox(height: 12),
                        ...snapshot.staff
                            .map((s) => _StaffCard(entry: s, isMe: s.userId == myId)),
                        if (snapshot.offline.isNotEmpty) ...[
                          const SizedBox(height: 8),
                          Padding(
                            padding: const EdgeInsets.fromLTRB(4, 8, 4, 8),
                            child: Text(
                              'Hoạt động gần đây',
                              style: context.theme.typography.body.sm.copyWith(
                                color: context.theme.colors.mutedForeground,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          ...snapshot.offline
                              .map((s) => _OfflineStaffCard(entry: s)),
                        ],
                        const SizedBox(height: 24),
                      ],
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

/// Shared big-title header for secondary tabs.
class _ScreenTitle extends StatelessWidget {
  const _ScreenTitle({required this.theme, required this.title});

  final FThemeData theme;
  final String title;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 10, 20, 6),
        child: Align(
          alignment: Alignment.centerLeft,
          child: Text(
            title,
            style: theme.typography.display.xl3.copyWith(
              fontWeight: FontWeight.w800,
              letterSpacing: -0.8,
              color: theme.colors.foreground,
            ),
          ),
        ),
      ),
    );
  }
}

class _SummaryRow extends StatelessWidget {
  const _SummaryRow({required this.snapshot});

  final StaffSnapshot snapshot;

  @override
  Widget build(BuildContext context) {
    final theme = context.theme;
    return Row(
      children: [
        Expanded(
          child: _GradientStat(
            value: '${snapshot.onlineCount}',
            label: 'Đang online',
            highlighted: true,
            theme: theme,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _GradientStat(
            value: '${snapshot.availableCount}',
            label: 'Sẵn sàng',
            theme: theme,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _GradientStat(
            value: '${snapshot.staff.length}',
            label: 'Nhân viên',
            theme: theme,
          ),
        ),
      ],
    );
  }
}

/// Stat tile — the first (highlighted) one carries the brand gradient.
class _GradientStat extends StatelessWidget {
  const _GradientStat({
    required this.value,
    required this.label,
    required this.theme,
    this.highlighted = false,
  });

  final String value;
  final String label;
  final FThemeData theme;
  final bool highlighted;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 16),
      decoration: BoxDecoration(
        gradient: highlighted ? AppBrand.bubbleGradient : null,
        color: highlighted ? null : theme.colors.card,
        borderRadius: BorderRadius.circular(18),
        border: highlighted
            ? null
            : Border.all(color: theme.colors.border.withValues(alpha: 0.6)),
        boxShadow: [
          BoxShadow(
            color: highlighted
                ? AppBrand.violet.withValues(alpha: 0.30)
                : theme.colors.background.withValues(alpha: 0.8),
            blurRadius: highlighted ? 16 : 8,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        children: [
          Text(
            value,
            style: theme.typography.display.xl.copyWith(
              fontWeight: FontWeight.w800,
              letterSpacing: -0.5,
              color: highlighted
                  ? theme.colors.primaryForeground
                  : theme.colors.foreground,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            label,
            style: theme.typography.body.xs.copyWith(
              color: highlighted
                  ? theme.colors.primaryForeground.withValues(alpha: 0.85)
                  : theme.colors.mutedForeground,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _StaffCard extends StatelessWidget {
  const _StaffCard({required this.entry, required this.isMe});

  final StaffEntry entry;
  final bool isMe;

  @override
  Widget build(BuildContext context) {
    final theme = context.theme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: theme.colors.card,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: isMe
                ? theme.colors.primary.withValues(alpha: 0.4)
                : theme.colors.border.withValues(alpha: 0.6),
          ),
          boxShadow: [
            BoxShadow(
              color: theme.colors.background.withValues(alpha: 0.8),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Row(
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                AgentAvatar(name: entry.name, size: 44),
                Positioned(
                  right: -1,
                  bottom: -1,
                  child: PresenceDot(online: entry.online, size: 11),
                ),
              ],
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          isMe ? '${entry.name} (bạn)' : entry.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: theme.typography.body.md.copyWith(
                            fontWeight: FontWeight.w700,
                            letterSpacing: -0.2,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(
                    entry.role == 'admin' ? 'Quản trị' : 'Nhân viên hỗ trợ',
                    style: theme.typography.body.sm
                        .copyWith(color: theme.colors.mutedForeground),
                  ),
                  if (entry.lastSeenAt != null && entry.lastSeenAt!.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        'Hoạt động ${relativeTimeVi(entry.lastSeenAt!)}',
                        style: theme.typography.body.xs.copyWith(
                          color: theme.colors.mutedForeground.withValues(alpha: 0.8),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (entry.inCall)
                  _chip(theme, 'Đang gọi', theme.colors.destructive)
                else if (entry.busy)
                  _chip(theme, 'Bận', theme.colors.secondary)
                else if (entry.available)
                  _chip(theme, 'Sẵn sàng', AppBrand.success)
                else if (!entry.online)
                  _chip(theme, 'Ngoại tuyến', theme.colors.mutedForeground),
                if (entry.activeChats > 0)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      '${entry.activeChats} hội thoại',
                      style: theme.typography.body.xs.copyWith(
                        color: theme.colors.mutedForeground,
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _chip(FThemeData theme, String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: theme.typography.body.xs.copyWith(
          color: color,
          fontWeight: FontWeight.w600,
          fontSize: 10.5,
        ),
      ),
    );
  }
}

/// One recently-active-but-OFFLINE member: dimmed row with a durable
/// "last seen" (DB backstop — survives backend restarts). Lets an admin
/// see who just dropped (flaky network) instead of an empty board.
class _OfflineStaffCard extends StatelessWidget {
  const _OfflineStaffCard({required this.entry});

  final OfflineStaffEntry entry;

  @override
  Widget build(BuildContext context) {
    final theme = context.theme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: theme.colors.card.withValues(alpha: 0.55),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: theme.colors.border.withValues(alpha: 0.4)),
        ),
        child: Row(
          children: [
            Opacity(opacity: 0.55, child: AgentAvatar(name: entry.name, size: 44)),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    entry.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.typography.body.md.copyWith(
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.2,
                      color: theme.colors.foreground.withValues(alpha: 0.7),
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    '${entry.role == 'admin' ? 'Quản trị' : 'Nhân viên hỗ trợ'} · ${relativeTimeVi(entry.lastSeenAt)}',
                    style: theme.typography.body.sm.copyWith(
                      color: theme.colors.mutedForeground,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            _chipOffline(theme),
          ],
        ),
      ),
    );
  }

  Widget _chipOffline(FThemeData theme) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: theme.colors.mutedForeground.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        'Ngoại tuyến',
        style: theme.typography.body.xs.copyWith(
          color: theme.colors.mutedForeground,
          fontWeight: FontWeight.w600,
          fontSize: 10.5,
        ),
      ),
    );
  }
}

/// "5 phút trước" / "2 giờ trước" / "—". Input: RFC3339 string.
String relativeTimeVi(String rfc3339) {
  if (rfc3339.isEmpty) return '—';
  final dt = DateTime.tryParse(rfc3339);
  if (dt == null) return '—';
  final diff = DateTime.now().difference(dt);
  if (diff.isNegative) return 'vừa xong';
  final mins = diff.inMinutes;
  if (mins < 1) return 'vừa xong';
  if (mins < 60) return '$mins phút trước';
  final hours = diff.inHours;
  if (hours < 24) return '$hours giờ trước';
  final days = diff.inDays;
  if (days < 7) return '$days ngày trước';
  return '—';
}
