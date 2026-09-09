import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:forui/forui.dart';
import 'package:go_router/go_router.dart';

import '../../core/design.dart';
import '../../core/router.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/net/ws_client.dart';
import '../../shared/widgets.dart';
import 'chat_service.dart';
import 'conversations_controller.dart';
import 'models.dart';

/// The support queue — the agent's home screen.
///
/// Live-updating list of customer conversations with unread badges,
/// queue filters (all / waiting / mine) as an animated segmented
/// control, a WS health indicator, and pull-to-refresh. Rows use the
/// modern messenger list layout: gradient avatar + presence, name,
/// time, two-line preview, and a purple unread pill.
class ConversationsScreen extends ConsumerWidget {
  const ConversationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final channels = ref.watch(filteredChannelsProvider);
    final queue = ref.watch(conversationsProvider);
    final status = ref.watch(chatStatusProvider).value;
    final user = ref.watch(authControllerProvider).user;
    final totalUnread = ref.watch(totalUnreadProvider);

    return Scaffold(
      backgroundColor: context.theme.colors.background,
      body: Column(
        children: [
          _QueueHeader(
            totalUnread: totalUnread,
            online: status == WsStatus.connected,
            userName: user?.name ?? '?',
            userAvatar: user?.avatarUrl,
            onReconnect: status != null && status != WsStatus.connected
                ? () {
                    ref.read(chatLiveServiceProvider)?.reconnectNow();
                    ref.read(conversationsProvider.notifier).refetch();
                  }
                : null,
            onAvatar: () => ref.read(routerProvider).go('/settings'),
          ),
          const _ConnectionBanner(),
          _FilterTabs(),
          Expanded(
            child: AnimatedSwitcher(
              duration: AppMotion.page,
              switchInCurve: AppMotion.easeOutCubic,
              child: queue.hasValue
                  ? (channels.isEmpty
                      ? EmptyState(
                          key: const ValueKey('empty'),
                          icon: FLucideIcons.messagesSquare,
                          title: 'Không có hội thoại',
                          message:
                              'Khách hàng mới sẽ xuất hiện ở đây ngay khi họ bắt đầu trò chuyện.',
                          onRetry: () => ref
                              .read(conversationsProvider.notifier)
                              .refetch(),
                        )
                      : RefreshIndicator(
                          key: const ValueKey('list'),
                          onRefresh: () => ref
                              .read(conversationsProvider.notifier)
                              .refetch(showSpinner: false),
                          child: ListView.separated(
                            physics: const AlwaysScrollableScrollPhysics(),
                            padding: const EdgeInsets.fromLTRB(
                                12, 4, 12, 110),
                            itemCount: channels.length,
                            separatorBuilder: (_, __) =>
                                const SizedBox(height: 4),
                            itemBuilder: (context, i) => _ConversationRow(
                              channel: channels[i],
                            ),
                          ),
                        ))
                  : queue.hasError
                      ? EmptyState(
                          key: const ValueKey('error'),
                          icon: FLucideIcons.circleAlert,
                          title: 'Không tải được danh sách',
                          message: 'Kiểm tra kết nối rồi thử lại.',
                          onRetry: () => ref
                              .read(conversationsProvider.notifier)
                              .refetch(),
                        )
                      : const Center(
                          key: ValueKey('loading'),
                          child: CircularProgressIndicator(),
                        ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Big-title header with the agent's avatar (taps into settings) and a
/// live connection dot.
class _QueueHeader extends StatelessWidget {
  const _QueueHeader({
    required this.totalUnread,
    required this.online,
    required this.userName,
    required this.userAvatar,
    required this.onAvatar,
    this.onReconnect,
  });

  final int totalUnread;
  final bool online;
  final String userName;
  final String? userAvatar;
  final VoidCallback onAvatar;
  final VoidCallback? onReconnect;

  @override
  Widget build(BuildContext context) {
    final theme = context.theme;
    return SafeArea(
      bottom: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 10, 16, 6),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Hỗ trợ',
                    style: theme.typography.display.xl3.copyWith(
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.8,
                      color: theme.colors.foreground,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Container(
                        width: 8,
                        height: 8,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: online
                              ? AppBrand.success
                              : theme.colors.mutedForeground,
                          boxShadow: [
                            BoxShadow(
                              color: (online
                                      ? AppBrand.success
                                      : theme.colors.mutedForeground)
                                  .withValues(alpha: 0.5),
                              blurRadius: 6,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        totalUnread > 0
                            ? '$totalUnread tin nhắn chưa đọc'
                            : online
                                ? 'Đang kết nối thời gian thực'
                                : 'Mất kết nối',
                        style: theme.typography.body.sm.copyWith(
                          color: theme.colors.mutedForeground,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            if (onReconnect != null)
              _HeaderIconButton(
                icon: FLucideIcons.wifiOff,
                color: theme.colors.destructive,
                onTap: onReconnect!,
              ),
            const SizedBox(width: 4),
            GestureDetector(
              onTap: onAvatar,
              child: AgentAvatar(
                name: userName,
                imageUrl: userAvatar,
                size: 42,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Small circular header action.
class _HeaderIconButton extends StatelessWidget {
  const _HeaderIconButton({
    required this.icon,
    required this.onTap,
    this.color,
  });

  final IconData icon;
  final VoidCallback onTap;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final theme = context.theme;
    return Semantics(
      button: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Container(
          width: 38,
          height: 38,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: theme.colors.muted,
          ),
          child: Icon(
            icon,
            size: 17,
            color: color ?? theme.colors.foreground,
          ),
        ),
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

/// Queue filter as an animated segmented pill control.
class _FilterTabs extends ConsumerWidget {
  static const _filters = [
    (QueueFilter.all, 'Tất cả'),
    (QueueFilter.unassigned, 'Chờ xử lý'),
    (QueueFilter.mine, 'Của tôi'),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = context.theme;
    final selected = ref.watch(queueFilterProvider);
    final waitingCount = (ref.watch(conversationsProvider).value ?? [])
        .where((c) => c.isOpen && !c.assignedToMe)
        .length;

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 8),
      child: SizedBox(
        height: 40,
        child: Stack(
          children: [
            // Track.
            Container(
              decoration: BoxDecoration(
                color: theme.colors.muted,
                borderRadius: BorderRadius.circular(999),
              ),
            ),
            // Sliding selection pill.
            LayoutBuilder(
              builder: (context, constraints) {
                final w = constraints.maxWidth / _filters.length;
                final pillWidth = w * 0.94;
                final index =
                    _filters.indexWhere((f) => f.$1 == selected).clamp(0, 2);
                return Stack(
                  children: [
                    AnimatedPositioned(
                      duration: AppMotion.page,
                      curve: AppMotion.overshoot,
                      left: index * w + (w - pillWidth) / 2,
                      top: 3,
                      width: pillWidth,
                      height: 34,
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: AppBrand.bubbleGradient,
                          borderRadius: BorderRadius.circular(999),
                          boxShadow: [
                            BoxShadow(
                              color: AppBrand.violet.withValues(alpha: 0.32),
                              blurRadius: 8,
                              offset: const Offset(0, 3),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),
            Row(
              children: [
                for (final (filter, label) in _filters)
                  Expanded(
                    child: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: () =>
                          ref.read(queueFilterProvider.notifier).set(filter),
                      child: Center(
                        child: AnimatedDefaultTextStyle(
                          duration: AppMotion.page,
                          curve: Curves.easeOut,
                          style: theme.typography.body.sm.copyWith(
                            color: selected == filter
                                ? theme.colors.primaryForeground
                                : theme.colors.mutedForeground,
                            fontWeight: selected == filter
                                ? FontWeight.w700
                                : FontWeight.w500,
                          ),
                          child: Text(
                            filter == QueueFilter.unassigned &&
                                    waitingCount > 0
                                ? 'Chờ xử lý · $waitingCount'
                                : label,
                            maxLines: 1,
                          ),
                        ),
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
}

/// One conversation row: messenger-style — avatar + presence, name,
/// time, preview, status chip, purple unread pill.
class _ConversationRow extends ConsumerWidget {
  const _ConversationRow({required this.channel});

  final Channel channel;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = context.theme;
    final unread = channel.unreadEmployee;

    return Semantics(
      button: true,
      label: channel.displayName,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () {
          final id = channel.id;
          context.push('/chat/$id');
        },
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 2),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          decoration: BoxDecoration(
            color: theme.colors.card,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(
              color: unread > 0
                  ? theme.colors.primary.withValues(alpha: 0.35)
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
              // Avatar + presence + closed check.
              Stack(
                clipBehavior: Clip.none,
                children: [
                  AgentAvatar(
                    name: channel.displayName,
                    imageUrl: channel.customer?.avatarUrl,
                    size: 48,
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
                    )
                  else
                    Positioned(
                      right: -1,
                      bottom: -1,
                      child: PresenceDot(
                        online: channel.isOpen,
                        size: 12,
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
                              fontWeight: FontWeight.w700,
                              letterSpacing: -0.2,
                              color: theme.colors.foreground,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          formatListTime(
                              channel.lastMessageAt ?? channel.createdAt),
                          style: theme.typography.body.xs.copyWith(
                            color: unread > 0
                                ? theme.colors.primary
                                : theme.colors.mutedForeground,
                            fontWeight:
                                unread > 0 ? FontWeight.w700 : FontWeight.w500,
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
                          _chip(
                            theme,
                            channel.assignedTo!.fullName ?? 'Đã gán',
                            theme.colors.muted,
                          ),
                          const SizedBox(width: 6),
                        ] else if (channel.isOpen) ...[
                          _chip(theme, 'Chờ nhận', theme.colors.primary),
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
                        if (unread > 0) ...[
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 3,
                            ),
                            constraints:
                                const BoxConstraints(minWidth: 22),
                            decoration: BoxDecoration(
                              gradient: AppBrand.bubbleGradient,
                              borderRadius: BorderRadius.circular(999),
                              boxShadow: [
                                BoxShadow(
                                  color:
                                      AppBrand.violet.withValues(alpha: 0.35),
                                  blurRadius: 6,
                                  offset: const Offset(0, 2),
                                ),
                              ],
                            ),
                            child: Text(
                              unread > 99 ? '99+' : '$unread',
                              textAlign: TextAlign.center,
                              style: theme.typography.body.xs.copyWith(
                                color: theme.colors.primaryForeground,
                                fontSize: 11,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ],
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
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        maxLines: 1,
        style: theme.typography.body.xs.copyWith(
          color: color,
          fontWeight: FontWeight.w600,
          fontSize: 10.5,
        ),
      ),
    );
  }
}
