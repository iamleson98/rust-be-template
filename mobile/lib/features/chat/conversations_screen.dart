import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:forui/forui.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/net/ws_client.dart';
import '../../core/router.dart';
import '../../shared/widgets.dart';
import 'chat_service.dart';
import 'conversations_controller.dart';
import 'models.dart';

/// The support queue — the agent's home screen.
///
/// Live-updating list of customer conversations with unread badges,
/// queue filters (all / waiting / mine), a WS health indicator, and
/// pull-to-refresh.
class ConversationsScreen extends ConsumerWidget {
  const ConversationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final channels = ref.watch(filteredChannelsProvider);
    final queue = ref.watch(conversationsProvider);
    final status = ref.watch(chatStatusProvider).value;
    final user = ref.watch(authControllerProvider).user;
    final totalUnread = ref.watch(totalUnreadProvider);

    return FScaffold(
      header: FHeader(
        title: Text(
          totalUnread > 0 ? 'Hỗ trợ ($totalUnread)' : 'Hỗ trợ',
        ),
        suffixes: [
          if (status != null && status != WsStatus.connected)
            FHeaderAction(
              icon: Icon(
                FLucideIcons.wifiOff,
                color: context.theme.colors.destructive,
              ),
              onPress: () {
                ref.read(chatLiveServiceProvider)?.reconnectNow();
                ref.read(conversationsProvider.notifier).refetch();
              },
            ),
          FHeaderAction(
            icon: AgentAvatar(
              name: user?.name ?? '?',
              imageUrl: user?.avatarUrl,
              size: 30,
            ),
            onPress: () => ref.read(routerProvider).go('/settings'),
          ),
        ],
      ),
      child: Column(
        children: [
          const _ConnectionBanner(),
          const _FilterTabs(),
          Expanded(
            child: queue.hasValue
                ? (channels.isEmpty
                    ? EmptyState(
                        icon: FLucideIcons.messagesSquare,
                        title: 'Không có hội thoại',
                        message:
                            'Khách hàng mới sẽ xuất hiện ở đây ngay khi họ bắt đầu trò chuyện.',
                        onRetry: () => ref
                            .read(conversationsProvider.notifier)
                            .refetch(),
                      )
                    : RefreshIndicator(
                        onRefresh: () => ref
                            .read(conversationsProvider.notifier)
                            .refetch(showSpinner: false),
                        child: ListView.separated(
                          physics: const AlwaysScrollableScrollPhysics(),
                          padding: const EdgeInsets.fromLTRB(12, 4, 12, 24),
                          itemCount: channels.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (context, i) =>
                              _ConversationRow(channel: channels[i]),
                        ),
                      ))
                : queue.hasError
                    ? EmptyState(
                        icon: FLucideIcons.circleAlert,
                        title: 'Không tải được danh sách',
                        message: 'Kiểm tra kết nối rồi thử lại.',
                        onRetry: () =>
                            ref.read(conversationsProvider.notifier).refetch(),
                      )
                    : const Center(child: CircularProgressIndicator()),
          ),
        ],
      ),
    );
  }
}

/// Shows a slim warning banner whenever the live socket is down.
class _ConnectionBanner extends ConsumerWidget {
  const _ConnectionBanner();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(chatStatusProvider).value;
    if (status == null || status == WsStatus.connected) {
      return const SizedBox.shrink();
    }
    final theme = context.theme;
    return Container(
      width: double.infinity,
      color: theme.colors.destructive.withValues(alpha: 0.12),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Row(
        children: [
          Icon(FLucideIcons.wifiOff, size: 14, color: theme.colors.destructive),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              status == WsStatus.backoff
                  ? 'Mất kết nối thời gian thực — đang thử lại…'
                  : 'Đang kết nối lại…',
              style: theme.typography.body.sm
                  .copyWith(color: theme.colors.destructive),
            ),
          ),
        ],
      ),
    );
  }
}

/// Queue filter pills.
class _FilterTabs extends ConsumerWidget {
  const _FilterTabs();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selected = ref.watch(queueFilterProvider);
    final theme = context.theme;
    final waitingCount = (ref.watch(conversationsProvider).value ?? [])
        .where((c) => c.isOpen && !c.assignedToMe)
        .length;

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
      child: Row(
        children: [
          for (final (filter, label) in [
            (QueueFilter.all, 'Tất cả'),
            (QueueFilter.unassigned, 'Chờ xử lý'),
            (QueueFilter.mine, 'Của tôi'),
          ])
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: _pill(
                context,
                theme: theme,
                label: filter == QueueFilter.unassigned && waitingCount > 0
                    ? 'Chờ xử lý · $waitingCount'
                    : label,
                selected: selected == filter,
                onTap: () =>
                    ref.read(queueFilterProvider.notifier).set(filter),
              ),
            ),
        ],
      ),
    );
  }

  Widget _pill(
    BuildContext context, {
    required FThemeData theme,
    required String label,
    required bool selected,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
        decoration: BoxDecoration(
          color: selected ? theme.colors.primary : theme.colors.muted,
          borderRadius: BorderRadius.circular(999),
        ),
        child: Text(
          label,
          style: theme.typography.body.sm.copyWith(
            color: selected
                ? theme.colors.primaryForeground
                : theme.colors.mutedForeground,
            fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
          ),
        ),
      ),
    );
  }
}

/// One conversation row: avatar, name, last message, time, unread badge,
/// status chips.
class _ConversationRow extends ConsumerWidget {
  const _ConversationRow({required this.channel});

  final Channel channel;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = context.theme;
    final unread = channel.unreadEmployee;

    return GestureDetector(
      onTap: () {
        final id = channel.id;
        context.push('/chat/$id');
      },
      child: FCard(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Stack(
                clipBehavior: Clip.none,
                children: [
                  AgentAvatar(
                    name: channel.displayName,
                    imageUrl: channel.customer?.avatarUrl,
                    size: 46,
                  ),
                  if (channel.isClosed)
                    Positioned(
                      right: -2,
                      bottom: -2,
                      child: Container(
                        padding: const EdgeInsets.all(3),
                        decoration: BoxDecoration(
                          color: theme.colors.background,
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          FLucideIcons.check,
                          size: 12,
                          color: theme.colors.mutedForeground,
                        ),
                      ),
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
                        Expanded(
                          child: Text(
                            channel.displayName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: theme.typography.body.md.copyWith(
                              fontWeight: FontWeight.w600,
                              color: theme.colors.foreground,
                            ),
                          ),
                        ),
                        if (unread > 0)
                          Padding(
                            padding: const EdgeInsets.only(left: 8),
                            child: FBadge(
                              variant: FBadgeVariant.primary,
                              child: Text(
                                unread > 99 ? '99+' : '$unread',
                              ),
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Row(
                      children: [
                        if (channel.assignedToMe) ...[
                          _chip(theme, 'Của bạn', theme.colors.primary),
                          const SizedBox(width: 6),
                        ] else if (channel.assignedTo != null) ...[
                          _chip(theme, channel.assignedTo!.fullName ?? 'Đã gán',
                              theme.colors.muted),
                          const SizedBox(width: 6),
                        ] else if (channel.isOpen) ...[
                          _chip(theme, 'Chờ nhận', theme.colors.secondary),
                          const SizedBox(width: 6),
                        ],
                        Expanded(
                          child: Text(
                            channel.lastMessagePreview ?? 'Chưa có tin nhắn',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: theme.typography.body.sm.copyWith(
                              color: unread > 0
                                  ? theme.colors.foreground
                                  : theme.colors.mutedForeground,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Text(
                formatRelative(channel.lastMessageAt ?? channel.createdAt),
                style: theme.typography.body.sm.copyWith(
                  color: theme.colors.mutedForeground,
                ),
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
        maxLines: 1,
        style: theme.typography.body.sm.copyWith(color: color),
      ),
    );
  }
}
