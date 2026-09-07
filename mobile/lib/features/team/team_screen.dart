import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:forui/forui.dart';

import '../../core/auth/auth_controller.dart';
import '../../shared/widgets.dart';
import '../chat/models.dart';
import 'presence_controller.dart';

/// Team board: who's online, who's on a call, chat load, and whether the
/// NullClaw bot is currently owning support.
class TeamScreen extends ConsumerWidget {
  const TeamScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final snapshot = ref.watch(staffPresenceProvider);
    final myId = ref.watch(authControllerProvider).user?.id;

    return FScaffold(
      header: FHeader(title: const Text('Đội ngũ')),
      child: snapshot == null
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: () =>
                  ref.read(staffPresenceProvider.notifier).refetch(),
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(12),
                children: [
                  if (snapshot.botActive)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: FAlert(
                        variant: FAlertVariant.primary,
                        icon: const Icon(FLucideIcons.info),
                        title: const Text('Bot đang trực'),
                        subtitle: const Text(
                          'Không có nhân viên online — NullClaw đang hỗ trợ khách.',
                        ),
                      ),
                    ),
                  _SummaryRow(snapshot: snapshot),
                  const SizedBox(height: 12),
                  ...snapshot.staff.map((s) => _StaffCard(entry: s, isMe: s.userId == myId)),
                  const SizedBox(height: 24),
                ],
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
          child: _stat(theme, '$snapshot.onlineCount', 'Đang online'),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _stat(theme, '$snapshot.availableCount', 'Sẵn sàng'),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _stat(theme, '${snapshot.staff.length}', 'Nhân viên'),
        ),
      ],
    );
  }

  Widget _stat(FThemeData theme, String value, String label) {
    return FCard(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 14),
        child: Column(
          children: [
            Text(
              value,
              style: theme.typography.display.xl.copyWith(
                fontWeight: FontWeight.w700,
                color: theme.colors.foreground,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: theme.typography.body.sm
                  .copyWith(color: theme.colors.mutedForeground),
            ),
          ],
        ),
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
      padding: const EdgeInsets.only(bottom: 8),
      child: FCard(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              AgentAvatar(name: entry.name, size: 42),
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
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        const SizedBox(width: 6),
                        PresenceDot(online: entry.online),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Text(
                      entry.role == 'admin' ? 'Quản trị' : 'Nhân viên hỗ trợ',
                      style: theme.typography.body.sm
                          .copyWith(color: theme.colors.mutedForeground),
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
                    _chip(theme, 'Sẵn sàng', const Color(0xFF22C55E))
                  else if (!entry.online)
                    _chip(theme, 'Ngoại tuyến', theme.colors.mutedForeground),
                  if (entry.activeChats > 0)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(
                        '${entry.activeChats} hội thoại',
                        style: theme.typography.body.sm.copyWith(
                          color: theme.colors.mutedForeground,
                        ),
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _chip(FThemeData theme, String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: theme.typography.body.sm.copyWith(color: color),
      ),
    );
  }
}
