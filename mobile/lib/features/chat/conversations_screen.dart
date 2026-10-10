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
import 'customer_presence.dart';
import 'models.dart';

/// The support queue — the agent's home screen.
///
/// Live-updating list of customer conversations with unread badges,
/// queue filters (all / waiting / mine) as an animated segmented
/// control, a WS health indicator, and pull-to-refresh. Rows use the
/// messenger list layout: tinted avatar + presence, name, time, the
/// last message, and a blue unread count.
class ConversationsScreen extends ConsumerWidget {
  const ConversationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final channels = ref.watch(filteredChannelsProvider);
    final onlineCount = onlineLead(
      channels,
      ref.watch(customerPresenceProvider),
    );
    final queue = ref.watch(conversationsProvider);
    final status = ref.watch(chatStatusProvider).value;
    final user = ref.watch(authControllerProvider).user;

    return Scaffold(
      backgroundColor: context.theme.colors.background,
      body: Column(
        children: [
          _QueueHeader(
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
                            message: 'Khách hàng mới sẽ xuất hiện ở đây ngay khi họ bắt đầu trò chuyện.',
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
                              padding: const EdgeInsets.fromLTRB(12, 4, 12, 24),
                              itemCount: channels.length,
                              separatorBuilder: (_, __) =>
                                  const SizedBox(height: 4),
                              itemBuilder: (context, i) => _ConversationRow(
                                channel: channels[i],
                                online: i < onlineCount,
                                section: _sectionLabel(i, onlineCount),
                              ),
                            ),
                          ))
                  : queue.hasError
                  ? EmptyState(
                      key: const ValueKey('error'),
                      icon: FLucideIcons.circleAlert,
                      title: 'Không tải được danh sách',
                      message: 'Kiểm tra kết nối rồi thử lại.',
                      onRetry: () =>
                          ref.read(conversationsProvider.notifier).refetch(),
                    )
                  : const _ConversationSkeleton(key: ValueKey('loading')),
            ),
          ),
        ],
      ),
    );
  }
}

/// Big-title header with the agent's avatar (taps into settings). Unread
/// counts live on the tab badge and a dropped socket gets its own banner,
/// so the header stays quiet.
class _QueueHeader extends StatelessWidget {
  const _QueueHeader({
    required this.userName,
    required this.userAvatar,
    required this.onAvatar,
    this.onReconnect,
  });

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
        padding: const EdgeInsets.fromLTRB(20, 12, 16, 8),
        child: Row(
          children: [
            Expanded(
              child: Text(
                'Hỗ trợ',
                style: theme.typography.display.xl2.copyWith(
                  fontWeight: FontWeight.w700,
                  letterSpacing: -0.6,
                  color: theme.colors.foreground,
                ),
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
          child: Icon(icon, size: 17, color: color ?? theme.colors.foreground),
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
              style: theme.typography.body.sm.copyWith(
                color: theme.colors.destructive,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Queue filter as a segmented control: a white segment slides on a
/// quiet track (no colored fill competing with the rows).
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
                final index = _filters
                    .indexWhere((f) => f.$1 == selected)
                    .clamp(0, 2);
                return Stack(
                  children: [
                    AnimatedPositioned(
                      duration: AppMotion.page,
                      curve: AppMotion.easeOutCubic,
                      left: index * w + (w - pillWidth) / 2,
                      top: 3,
                      width: pillWidth,
                      height: 34,
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          color: theme.colors.card,
                          borderRadius: BorderRadius.circular(999),
                          boxShadow: AppShadow.soft,
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
                                ? theme.colors.foreground
                                : theme.colors.mutedForeground,
                            fontWeight: selected == filter
                                ? FontWeight.w600
                                : FontWeight.w500,
                          ),
                          child: Text(
                            filter == QueueFilter.unassigned && waitingCount > 0
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

/// The heading above row [i]: where the online customers start, and
/// where they end.
String? _sectionLabel(int i, int onlineCount) {
  if (onlineCount == 0) return null;
  if (i == 0) return 'Đang online · $onlineCount';
  if (i == onlineCount) return 'Ngoại tuyến';
  return null;
}

/// Heading over a group of rows; the online group's carries a green dot.
class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text, {required this.online});

  final String text;
  final bool online;

  @override
  Widget build(BuildContext context) {
    final theme = context.theme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 10, 8, 4),
      child: Row(
        children: [
          if (online) ...[
            const PresenceDot(online: true, size: 8),
            const SizedBox(width: 6),
          ],
          Text(
            text.toUpperCase(),
            style: theme.typography.body.xs.copyWith(
              color: theme.colors.mutedForeground,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.6,
            ),
          ),
        ],
      ),
    );
  }
}

/// One conversation row: messenger-style — avatar with a green dot while
/// the customer is online, name, time, preview, status chip, purple
/// unread pill.
class _ConversationRow extends ConsumerWidget {
  const _ConversationRow({
    required this.channel,
    required this.online,
    this.section,
  });

  final Channel channel;

  /// The customer is signed in with the site open.
  final bool online;

  /// Heading to show above this row, if it starts a group.
  final String? section;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = context.theme;
    final unread = channel.unreadEmployee;

    final row = Semantics(
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
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: theme.colors.card,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: theme.colors.border),
            boxShadow: AppShadow.soft,
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
                  else if (online)
                    const Positioned(
                      right: -1,
                      bottom: -1,
                      child: PresenceDot(online: true, size: 12),
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
                            channel.lastMessageAt ?? channel.createdAt,
                          ),
                          style: theme.typography.body.xs.copyWith(
                            color: unread > 0
                                ? theme.colors.primary
                                : theme.colors.mutedForeground,
                            fontWeight: unread > 0
                                ? FontWeight.w700
                                : FontWeight.w500,
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
                            theme.colors.mutedForeground,
                          ),
                          const SizedBox(width: 6),
                        ] else if (channel.isOpen) ...[
                          _chip(theme, 'Chờ nhận', AppBrand.warning),
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
                            constraints: const BoxConstraints(minWidth: 22),
                            decoration: BoxDecoration(
                              color: theme.colors.primary,
                              borderRadius: BorderRadius.circular(999),
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
    final label = section;
    if (label == null) return row;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _SectionLabel(label, online: online),
        row,
      ],
    );
  }

  Widget _chip(FThemeData theme, String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
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

/// Loading placeholder for the queue — messenger-style skeleton rows
/// (avatar disc + name bar + preview bar) under one shared breathing
/// animation, instead of a bare centered spinner.
///
/// One [AnimationController] drives the WHOLE list (a `repaint`-
/// efficient single opacity sweep) — no per-row animations, no
/// per-frame layout changes: the skeleton renders once and only its
/// opacity animates, so even low-end devices paint it at 60fps.
class _ConversationSkeleton extends StatefulWidget {
  const _ConversationSkeleton({super.key});

  @override
  State<_ConversationSkeleton> createState() => _ConversationSkeletonState();
}

class _ConversationSkeletonState extends State<_ConversationSkeleton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _breath = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _breath.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: Tween(
        begin: 0.45,
        end: 1.0,
      ).animate(CurvedAnimation(parent: _breath, curve: Curves.easeInOut)),
      child: ListView.separated(
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(12, 4, 12, 24),
        itemCount: 7,
        separatorBuilder: (_, __) => const SizedBox(height: 4),
        itemBuilder: (context, _) => const _SkeletonRow(),
      ),
    );
  }
}

/// One skeleton row, shaped exactly like [_ConversationRow] so the
/// loaded list "lands" without any layout jump.
class _SkeletonRow extends StatelessWidget {
  const _SkeletonRow();

  @override
  Widget build(BuildContext context) {
    final block = context.theme.colors.muted;
    Widget bar(double w, double h) => Container(
      width: w,
      height: h,
      decoration: BoxDecoration(
        color: block,
        borderRadius: BorderRadius.circular(6),
      ),
    );
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(
        children: [
          // Avatar disc (same 46dp as the real rows).
          Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(shape: BoxShape.circle, color: block),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [bar(120, 12), bar(34, 10)],
                ),
                const SizedBox(height: 9),
                bar(210, 10),
                const SizedBox(height: 5),
                bar(150, 10),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
