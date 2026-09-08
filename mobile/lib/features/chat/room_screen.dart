import 'package:material_ui/material_ui.dart';
import 'dart:ui';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:forui/forui.dart';
import 'package:go_router/go_router.dart';

import '../../core/design.dart';
import '../../shared/widgets.dart';
import '../call/call_controller.dart';
import '../notifications/notification_service.dart';
import 'conversations_controller.dart';
import 'models.dart';
import 'rooms_controller.dart';

/// The 1:1 chat room — the app's centerpiece screen.
///
/// Modern messenger layout:
///   * a reverse [ListView] (index 0 = newest) so new WS messages dock
///     to the bottom without shifting the viewport, and older history
///     pages prepend (offset pagination) while scrolled up — infinite
///     loading in both directions;
///   * grouped bubbles with asymmetric tails, day dividers, avatars,
///     in-bubble timestamps and delivery ticks;
///   * a glassy composer with a morphing gradient send button, a
///     jump-to-bottom FAB and a "new messages" pill.
class RoomScreen extends ConsumerStatefulWidget {
  const RoomScreen({required this.channelId, super.key});

  final String channelId;

  @override
  ConsumerState<RoomScreen> createState() => _RoomScreenState();
}

class _RoomScreenState extends ConsumerState<RoomScreen> {
  final _composer = TextEditingController();
  final _scroll = ScrollController();
  late final RoomsNotifier _roomsNotifier;
  late final ActiveRoomNotifier _activeRoomNotifier;

  int _lastCount = 0;
  int _newCount = 0;
  bool _showJump = false;
  bool _jumpedInitial = false;

  /// Beyond this offset (from the bottom) the agent counts as "reading
  /// history": incoming messages no longer dock, they stack into the
  /// new-messages pill instead.
  static const double _nearBottom = 260;

  /// Start fetching older history this far from the list's top.
  static const double _loadOlderTrigger = 420;

  @override
  void initState() {
    super.initState();
    _roomsNotifier = ref.read(roomsProvider.notifier);
    _activeRoomNotifier = ref.read(activeRoomIdProvider.notifier);
    _scroll.addListener(_onScroll);
    Future(() {
      if (!mounted) return;
      _roomsNotifier.open(widget.channelId);
      _activeRoomNotifier.set(widget.channelId);
      ref.read(notificationServiceProvider).clearChannel(widget.channelId);
    });
  }

  @override
  void dispose() {
    // Mutating providers straight from dispose can collide with a
    // concurrent build (route pop rebuilds the shell) — Riverpod 3
    // rejects that. Defer to after the current frame; the notifiers'
    // mounted guards make this safe even at full teardown.
    final rooms = _roomsNotifier;
    final active = _activeRoomNotifier;
    final channelId = widget.channelId;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      active.set(null);
      rooms.close(channelId);
    });
    _composer.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!_scroll.hasClients) return;
    final pos = _scroll.position;
    final showJump = pos.pixels > _nearBottom * 2;
    if (showJump != _showJump) setState(() => _showJump = showJump);
    // Reverse list: offset 0 = newest (bottom); maxScrollExtent = oldest.
    if (pos.maxScrollExtent - pos.pixels < _loadOlderTrigger) {
      _roomsNotifier.loadOlder(widget.channelId);
    }
  }

  void _jumpToBottom({bool animated = true}) {
    if (!_scroll.hasClients) return;
    if (!animated) {
      _scroll.jumpTo(0);
      return;
    }
    _scroll.animateTo(
      0,
      duration: const Duration(milliseconds: 320),
      curve: AppMotion.easeOutCubic,
    );
  }

  void _onMessagesChanged(List<ChatMessage> messages) {
    // First page landing: dock to the newest message without animation.
    if (!_jumpedInitial) {
      _jumpedInitial = true;
      _lastCount = messages.length;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _jumpToBottom(animated: false);
      });
      return;
    }
    if (messages.length <= _lastCount) {
      _lastCount = messages.length;
      // Trim the pill when messages vanish (leave/re-enter guard).
      // Called during build — defer the visual update to post-frame.
      if (_newCount > 0) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) setState(() => _newCount = 0);
        });
      }
      return;
    }
    final delta = messages.length - _lastCount;
    _lastCount = messages.length;

    // Dock to the bottom when the agent is reading live (or just sent
    // something); otherwise surface a pill so history reading isn't
    // interrupted.
    final nearBottom = !_scroll.hasClients ||
        _scroll.position.pixels < _nearBottom ||
        _lastCount - delta < 1;
    if (nearBottom) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _jumpToBottom();
      });
    } else {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) setState(() => _newCount += delta);
      });
    }
  }

  Future<void> _send() async {
    final text = _composer.text;
    if (text.trim().isEmpty) return;
    _composer.clear();
    await ref.read(roomsProvider.notifier).send(widget.channelId, text);
    // Our own message always docks the view.
    _jumpToBottom();
  }

  void _startCall(Channel channel) {
    if (channel.userId.isEmpty) {
      showFToast(
        context: context,
        variant: FToastVariant.destructive,
        title: const Text('Không gọi được'),
        description: const Text('Thiếu thông tin khách hàng'),
        alignment: FToastAlignment.bottomCenter,
      );
      return;
    }
    ref.read(callUiStateProvider.notifier).startCall(
          customerId: channel.userId,
          customerName: channel.displayName,
          channelId: channel.id,
        );
  }

  void _openActions(Channel channel) {
    final theme = context.theme;
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: theme.colors.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: 10),
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: theme.colors.mutedForeground.withValues(alpha: 0.35),
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 20, 8),
              child: Row(
                children: [
                  AgentAvatar(
                    name: channel.displayName,
                    imageUrl: channel.customer?.avatarUrl,
                    size: 44,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      channel.displayName,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: theme.typography.display.lg.copyWith(
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.3,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            if (channel.customer?.email != null)
              _sheetRow(FLucideIcons.mail, channel.customer!.email!),
            if (channel.customer?.phone != null)
              _sheetRow(FLucideIcons.phone, channel.customer!.phone!),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  20, 8, 20, 8),
              child: Divider(color: theme.colors.border, height: 1),
            ),
            if (!channel.assignedToMe && !channel.isClosed)
              _sheetAction(
                icon: FLucideIcons.user,
                label: 'Nhận xử lý hội thoại',
                onTap: () async {
                  Navigator.of(context).pop();
                  final err = await ref
                      .read(conversationsProvider.notifier)
                      .channelAction(widget.channelId, 'claim');
                  _toast(err, 'Đã nhận hội thoại');
                },
              ),
            if (channel.assignedToMe && !channel.isClosed)
              _sheetAction(
                icon: FLucideIcons.check,
                label: 'Đóng hội thoại',
                onTap: () async {
                  Navigator.of(context).pop();
                  final err = await ref
                      .read(conversationsProvider.notifier)
                      .channelAction(widget.channelId, 'close');
                  _toast(err, 'Đã đóng hội thoại');
                },
              ),
            const SizedBox(height: 14),
          ],
        ),
      ),
    );
  }

  Widget _sheetRow(IconData icon, String text) {
    final theme = context.theme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
      child: Row(
        children: [
          Icon(icon, size: 16, color: theme.colors.mutedForeground),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              style: theme.typography.body.sm
                  .copyWith(color: theme.colors.mutedForeground),
            ),
          ),
        ],
      ),
    );
  }

  Widget _sheetAction({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
  }) {
    final theme = context.theme;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
        child: Row(
          children: [
            Icon(icon, size: 18, color: theme.colors.primary),
            const SizedBox(width: 12),
            Text(label, style: theme.typography.body.md),
          ],
        ),
      ),
    );
  }

  void _toast(String? error, String okMessage) {
    if (!mounted) return;
    showFToast(
      context: context,
      variant:
          error == null ? FToastVariant.primary : FToastVariant.destructive,
      title: Text(error == null ? okMessage : 'Thất bại'),
      description: error == null ? null : Text(error),
      alignment: FToastAlignment.bottomCenter,
    );
  }

  @override
  Widget build(BuildContext context) {
    final room = ref.watch(
      roomsProvider.select((rooms) => rooms[widget.channelId]),
    );
    final channel = room?.channel;
    final messages = room?.messages ?? const <ChatMessage>[];

    _onMessagesChanged(messages);

    return Scaffold(
      backgroundColor: context.theme.colors.background,
      resizeToAvoidBottomInset: true,
      body: Column(
        children: [
          _RoomHeader(
            channel: channel,
            online: room?.customerOnline ?? false,
            typingName: room?.typingName,
            onBack: () => context.pop(),
            onCall: channel == null || channel.isClosed ? null : () => _startCall(channel),
            onMore: channel == null ? null : () => _openActions(channel),
          ),
          if (channel != null && channel.isOpen && !channel.assignedToMe)
            _claimBar(context),
          if (room?.error != null) _errorBar(context, room!.error!),
          Expanded(
            child: Stack(
              children: [
                if (room == null || room.loading)
                  const Center(child: CircularProgressIndicator())
                else if (messages.isEmpty)
                  EmptyState(
                    icon: FLucideIcons.messageSquare,
                    title: 'Chưa có tin nhắn',
                    message: 'Hãy gửi lời chào để bắt đầu hỗ trợ.',
                  )
                else
                  _MessageList(
                    messages: messages,
                    channel: channel,
                    typingName: room.typingName,
                    loadingOlder: room.loadingOlder,
                    scroll: _scroll,
                    onRetry: (clientMsgId) => ref
                        .read(roomsProvider.notifier)
                        .retry(widget.channelId, clientMsgId),
                  ),
                // New-messages pill: floats just above the composer when
                // history reading outruns the live edge.
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 10,
                  child: IgnorePointer(
                    ignoring: _newCount == 0,
                    child: AnimatedScale(
                      scale: _newCount > 0 ? 1 : 0,
                      duration: AppMotion.quick,
                      curve: AppMotion.overshoot,
                      child: AnimatedOpacity(
                        opacity: _newCount > 0 ? 1 : 0,
                        duration: AppMotion.quick,
                        child: Center(
                          child: _NewMessagesPill(
                            count: _newCount,
                            onTap: () {
                              setState(() => _newCount = 0);
                              _jumpToBottom();
                            },
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                // Jump-to-bottom FAB sits above the pill, right edge.
                Positioned(
                  right: 6,
                  bottom: 64,
                  child: IgnorePointer(
                    ignoring: !_showJump,
                    child: AnimatedScale(
                      scale: _showJump ? 1 : 0,
                      duration: AppMotion.quick,
                      curve: AppMotion.overshoot,
                      child: _JumpFab(
                        newCount: _newCount,
                        onTap: () {
                          setState(() => _newCount = 0);
                          _jumpToBottom();
                        },
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          _ComposerBar(
            controller: _composer,
            onTyping: (text) => ref
                .read(roomsProvider.notifier)
                .typing(widget.channelId, text.isNotEmpty),
            onSend: _send,
          ),
        ],
      ),
    );
  }

  Widget _claimBar(BuildContext context) {
    final theme = context.theme;
    return Container(
      width: double.infinity,
      color: theme.colors.primary.withValues(alpha: 0.10),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        children: [
          Icon(
            FLucideIcons.info,
            size: 15,
            color: theme.colors.primary,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Hội thoại chưa có người phụ trách',
              style: theme.typography.body.sm
                  .copyWith(color: theme.colors.foreground),
            ),
          ),
          FButton(
            variant: FButtonVariant.primary,
            size: FButtonSizeVariant.sm,
            onPress: () async {
              final err = await ref
                  .read(conversationsProvider.notifier)
                  .channelAction(widget.channelId, 'claim');
              _toast(err, 'Đã nhận hội thoại');
            },
            child: const Text('Nhận xử lý'),
          ),
        ],
      ),
    );
  }

  Widget _errorBar(BuildContext context, String error) {
    final theme = context.theme;
    return Container(
      width: double.infinity,
      color: theme.colors.destructive.withValues(alpha: 0.10),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Text(
        error,
        style:
            theme.typography.body.sm.copyWith(color: theme.colors.destructive),
      ),
    );
  }
}

/// Translucent header: avatar + presence, name, live status line
/// (typing / online / offline), call & overflow actions.
class _RoomHeader extends StatelessWidget {
  const _RoomHeader({
    required this.channel,
    required this.online,
    required this.typingName,
    required this.onBack,
    this.onCall,
    this.onMore,
  });

  final Channel? channel;
  final bool online;
  final String? typingName;
  final VoidCallback onBack;
  final VoidCallback? onCall;
  final VoidCallback? onMore;

  @override
  Widget build(BuildContext context) {
    final theme = context.theme;
    final name = channel?.displayName ?? 'Hội thoại';

    final Color statusColor;
    final String statusText;
    if (typingName != null) {
      statusColor = theme.colors.primary;
      statusText = 'đang nhập…';
    } else if (online) {
      statusColor = AppBrand.success;
      statusText = 'Đang hoạt động';
    } else {
      statusColor = theme.colors.mutedForeground;
      statusText = 'Ngoại tuyến';
    }

    return ClipRect(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 14, sigmaY: 14),
        child: Container(
          decoration: BoxDecoration(
            color: theme.colors.background.withValues(alpha: 0.86),
            border: Border(
              bottom: BorderSide(color: theme.colors.border.withValues(alpha: 0.7)),
            ),
          ),
          child: SafeArea(
            bottom: false,
            child: SizedBox(
              height: 60,
              child: Row(
                children: [
                  _GhostButton(
                    icon: FLucideIcons.chevronLeft,
                    onTap: onBack,
                  ),
                  Stack(
                    clipBehavior: Clip.none,
                    children: [
                      AgentAvatar(
                        name: name,
                        imageUrl: channel?.customer?.avatarUrl,
                        size: 38,
                      ),
                      Positioned(
                        right: -1,
                        bottom: -1,
                        child: PresenceDot(online: online, size: 11),
                      ),
                    ],
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: theme.typography.body.md.copyWith(
                            fontWeight: FontWeight.w700,
                            letterSpacing: -0.2,
                          ),
                        ),
                        const SizedBox(height: 1),
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Container(
                              width: 7,
                              height: 7,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: statusColor,
                              ),
                            ),
                            const SizedBox(width: 5),
                            Text(
                              statusText,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: theme.typography.body.xs.copyWith(
                                color: statusColor,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  if (onCall != null)
                    _GhostButton(icon: FLucideIcons.phone, onTap: onCall!),
                  if (onMore != null)
                    _GhostButton(icon: FLucideIcons.moreHorizontal, onTap: onMore!),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Circular ghost icon button used in the room header.
class _GhostButton extends StatelessWidget {
  const _GhostButton({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = context.theme;
    return Semantics(
      button: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: SizedBox(
          width: 44,
          height: 44,
          child: Icon(icon, size: 21, color: theme.colors.foreground),
        ),
      ),
    );
  }
}

/// One row the list can render: message bubble / day divider / typing.
sealed class _Row {
  const _Row();
}

class _MessageRow extends _Row {
  const _MessageRow(
    this.message, {
    required this.firstInGroup,
    required this.lastInGroup,
    required this.showDayChip,
  });

  final ChatMessage message;

  /// Chronologically first of a consecutive-sender run (visual top).
  final bool firstInGroup;

  /// Chronologically last of a consecutive-sender run (visual bottom —
  /// carries the avatar & tail).
  final bool lastInGroup;

  /// Whether a day divider chip renders above this message.
  final bool showDayChip;
}

class _TypingRow extends _Row {
  const _TypingRow(this.name);
  final String name;
}

class _LoadingOlderRow extends _Row {
  const _LoadingOlderRow();
}

/// Reverse-rendered message list with grouping + day chips.
class _MessageList extends StatelessWidget {
  const _MessageList({
    required this.messages,
    required this.channel,
    required this.typingName,
    required this.loadingOlder,
    required this.scroll,
    required this.onRetry,
  });

  final List<ChatMessage> messages;
  final Channel? channel;
  final String? typingName;
  final bool loadingOlder;
  final ScrollController scroll;
  final void Function(String clientMsgId) onRetry;

  /// Messages from the same sender group when closer than this.
  static const _groupWindow = Duration(minutes: 3);

  List<_Row> _rows() {
    // Chronological order — the list reverses below (reverse list:
    // index 0 = newest/bottom). The "loading older" indicator belongs
    // at the chronological START so it lands at the visual TOP.
    final rows = <_Row>[];
    if (loadingOlder) rows.add(const _LoadingOlderRow());
    DateTime? lastDay;

    for (var i = 0; i < messages.length; i++) {
      final m = messages[i];
      final at = parseIso(m.createdAt);

      // Day divider whenever the calendar day flips (and for the very
      // first message).
      final day = at != null ? DateTime(at.year, at.month, at.day) : null;
      final newDay = day != null && (lastDay == null || day != lastDay);
      if (newDay) lastDay = day;

      // System messages render as centered meta rows (no grouping).
      if (m.isSystem) {
        rows.add(_MessageRow(m,
            firstInGroup: true, lastInGroup: true, showDayChip: newDay));
        continue;
      }

      final prev = i > 0 ? messages[i - 1] : null;
      final next = i + 1 < messages.length ? messages[i + 1] : null;

      bool sameAsPrev = false;
      if (prev != null &&
          !prev.isSystem &&
          !m.isSystem &&
          prev.senderType == m.senderType &&
          (prev.senderId ?? '') == (m.senderId ?? '')) {
        final prevAt = parseIso(prev.createdAt);
        sameAsPrev = at != null &&
            prevAt != null &&
            at.difference(prevAt).abs() < _groupWindow;
      }

      bool sameAsNext = false;
      if (next != null &&
          !next.isSystem &&
          !m.isSystem &&
          next.senderType == m.senderType &&
          (next.senderId ?? '') == (m.senderId ?? '')) {
        final nextAt = parseIso(next.createdAt);
        sameAsNext = at != null &&
            nextAt != null &&
            nextAt.difference(at).abs() < _groupWindow;
      }

      rows.add(_MessageRow(
        m,
        firstInGroup: !sameAsPrev,
        lastInGroup: !sameAsNext,
        showDayChip: newDay,
      ));
    }

    // Typing docks at the live edge: chronologically LAST → index 0
    // (visual very bottom) after the reversal below.
    if (typingName != null) rows.add(_TypingRow(typingName!));

    // Reverse list: index 0 must be the NEWEST row.
    return rows.reversed.toList();
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows();
    return ListView.builder(
      controller: scroll,
      reverse: true,
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
      itemCount: rows.length,
      itemBuilder: (context, i) {
        final row = rows[i];
        return switch (row) {
          _MessageRow r => _bubbleRow(context, r),
          _TypingRow r => _typingBubble(context, r.name),
          _LoadingOlderRow() => _loadingOlder(context),
        };
      },
    );
  }

  Widget _loadingOlder(BuildContext context) {
    final theme = context.theme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 14),
      child: Center(
        child: SizedBox(
          width: 22,
          height: 22,
          child: CircularProgressIndicator(
            strokeWidth: 2.2,
            color: theme.colors.primary,
          ),
        ),
      ),
    );
  }

  Widget _dayChip(BuildContext context, String label) {
    final theme = context.theme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
          decoration: BoxDecoration(
            color: theme.colors.mutedForeground.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(999),
          ),
          child: Text(
            label,
            style: theme.typography.body.xs.copyWith(
              color: theme.colors.mutedForeground,
              fontWeight: FontWeight.w600,
              fontSize: 11,
            ),
          ),
        ),
      ),
    );
  }

  Widget _typingBubble(BuildContext context, String name) {
    final theme = context.theme;
    return Align(
      alignment: Alignment.centerLeft,
      child: Padding(
        padding: const EdgeInsets.only(left: 44, top: 4, bottom: 2),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: theme.colors.card,
                border: Border.all(color: theme.colors.border),
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(18),
                  topRight: Radius.circular(18),
                  bottomLeft: Radius.circular(4),
                  bottomRight: Radius.circular(18),
                ),
              ),
              child: TypingIndicator(color: theme.colors.primary),
            ),
          ],
        ),
      ),
    );
  }

  Widget _bubbleRow(BuildContext context, _MessageRow r) {
    final m = r.message;
    if (m.isSystem) {
      return Column(
        children: [
          if (r.showDayChip)
            _dayChip(
              context,
              formatDayLabel(parseIso(m.createdAt) ?? DateTime.now()),
            )
          else
            const SizedBox(height: 2),
          _systemMessage(context, m),
        ],
      );
    }
    return _bubble(context, r);
  }

  Widget _systemMessage(BuildContext context, ChatMessage m) {
    final theme = context.theme;
    final isBot = m.senderType == 'assistant';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 20),
      child: Row(
        children: [
          Expanded(
            child: Divider(color: theme.colors.border, height: 1),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: isBot
                    ? theme.colors.primary.withValues(alpha: 0.09)
                    : theme.colors.mutedForeground.withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(999),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (isBot) ...[
                    Icon(
                      FLucideIcons.sparkles,
                      size: 12,
                      color: theme.colors.primary,
                    ),
                    const SizedBox(width: 4),
                  ],
                  Flexible(
                    child: Text(
                      isBot
                          ? '${m.senderName ?? 'Trợ lý'}: ${m.content ?? ''}'
                          : m.content ?? '',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: theme.typography.body.xs.copyWith(
                        color: isBot
                            ? theme.colors.primary
                            : theme.colors.mutedForeground,
                        fontWeight: FontWeight.w600,
                        fontSize: 11,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          Expanded(
            child: Divider(color: theme.colors.border, height: 1),
          ),
        ],
      ),
    );
  }

  Widget _bubble(BuildContext context, _MessageRow r) {
    final theme = context.theme;
    final m = r.message;
    final mine = m.isMe;
    final failed = m.sendState == SendState.failed;
    final sending = m.sendState == SendState.sending;

    final chip = r.showDayChip
        ? Padding(
            padding: const EdgeInsets.only(top: 6),
            child: _dayChip(
                context, formatDayLabel(parseIso(m.createdAt) ?? DateTime.now())),
          )
        : null;

    // Telegram-style grouping radii: the sender-side corner shrinks on
    // continuation messages, and only the group's visual bottom carries
    // the small "tail" radius. The other side always stays round (18).
    final topLeftR =
        !mine ? (r.firstInGroup ? 18.0 : 8.0) : 18.0;
    final topRightR =
        mine ? (r.firstInGroup ? 18.0 : 8.0) : 18.0;
    final bottomLeftR =
        !mine ? (r.lastInGroup ? 5.0 : 8.0) : 18.0;
    final bottomRightR =
        mine ? (r.lastInGroup ? 5.0 : 8.0) : 18.0;

    // The newest message of a group keeps the tail + timestamp; older
    // siblings in the same group still show their own timestamp (small).
    final bubble = GestureDetector(
      onTap: failed && m.clientMsgId != null ? () => onRetry(m.clientMsgId!) : null,
      child: Opacity(
        opacity: sending ? 0.65 : 1,
        child: Container(
          constraints: const BoxConstraints(maxWidth: 330),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
          decoration: BoxDecoration(
            gradient: failed
                ? null
                : mine
                    ? AppBrand.bubbleGradient
                    : null,
            color: failed
                ? theme.colors.destructive.withValues(alpha: 0.14)
                : mine
                    ? null
                    : theme.colors.card,
            border: Border.all(
              color: mine
                  ? Colors.transparent
                  : theme.colors.border.withValues(alpha: 0.8),
            ),
            borderRadius: BorderRadius.only(
              topLeft: Radius.circular(topLeftR),
              topRight: Radius.circular(topRightR),
              bottomLeft: Radius.circular(bottomLeftR),
              bottomRight: Radius.circular(bottomRightR),
            ),
            boxShadow: [
              if (!failed)
                BoxShadow(
                  color: mine
                      ? AppBrand.violet.withValues(alpha: 0.22)
                      : theme.colors.background.withValues(alpha: 0.9),
                  blurRadius: 10,
                  offset: const Offset(0, 3),
                ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                m.content ?? '',
                style: theme.typography.body.md.copyWith(
                  color: mine
                      ? theme.colors.primaryForeground
                      : theme.colors.foreground,
                  height: 1.35,
                ),
              ),
              const SizedBox(height: 3),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (failed) ...[
                    Icon(
                      FLucideIcons.circleAlert,
                      size: 12,
                      color: theme.colors.destructive,
                    ),
                    const SizedBox(width: 3),
                  ] else if (sending) ...[
                    Icon(
                      FLucideIcons.timer,
                      size: 12,
                      color: mine
                          ? theme.colors.primaryForeground.withValues(alpha: 0.7)
                          : theme.colors.mutedForeground,
                    ),
                    const SizedBox(width: 3),
                  ] else if (mine) ...[
                    Icon(
                      FLucideIcons.checkCheck,
                      size: 13,
                      color: theme.colors.primaryForeground
                          .withValues(alpha: 0.85),
                    ),
                    const SizedBox(width: 3),
                  ],
                  Text(
                    formatBubbleTime(m.createdAt),
                    style: theme.typography.body.xs.copyWith(
                      fontSize: 10.5,
                      color: mine
                          ? theme.colors.primaryForeground.withValues(alpha: 0.75)
                          : theme.colors.mutedForeground,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );

    final bubbleWithChip = Column(
      crossAxisAlignment:
          mine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
      children: [
        if (chip != null) Center(child: chip),
        bubble,
      ],
    );

    if (mine) {
      return Padding(
        padding: EdgeInsets.only(
          top: r.firstInGroup ? 6 : 2,
          bottom: r.lastInGroup ? 6 : 1,
        ),
        child: bubbleWithChip,
      );
    }

    // Theirs: avatar column docks to the group's visual bottom.
    return Padding(
      padding: EdgeInsets.only(
        top: r.firstInGroup ? 6 : 2,
        bottom: r.lastInGroup ? 6 : 1,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          SizedBox(
            width: 34,
            child: r.lastInGroup
                ? AgentAvatar(
                    name: m.senderName ??
                        channel?.displayName ??
                        'Khách hàng',
                    imageUrl: channel?.customer?.avatarUrl,
                    size: 30,
                  )
                : null,
          ),
          const SizedBox(width: 6),
          Flexible(child: bubbleWithChip),
        ],
      ),
    );
  }
}


/// "X tin nhắn mới" pill — Telegram-style catch-up affordance.
class _NewMessagesPill extends StatelessWidget {
  const _NewMessagesPill({required this.count, required this.onTap});

  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = context.theme;
    return Semantics(
      button: true,
      label: 'Xem $count tin nhắn mới',
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          decoration: BoxDecoration(
            gradient: AppBrand.bubbleGradient,
            borderRadius: BorderRadius.circular(999),
            boxShadow: [
              BoxShadow(
                color: AppBrand.violet.withValues(alpha: 0.45),
                blurRadius: 16,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                FLucideIcons.arrowDown,
                size: 14,
                color: theme.colors.primaryForeground,
              ),
              const SizedBox(width: 6),
              Text(
                '$count tin nhắn mới',
                style: theme.typography.body.xs.copyWith(
                  color: theme.colors.primaryForeground,
                  fontWeight: FontWeight.w700,
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Gradient jump-to-bottom FAB with an unread-new badge.
class _JumpFab extends StatelessWidget {
  const _JumpFab({required this.newCount, required this.onTap});

  final int newCount;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Xuống tin nhắn mới nhất',
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            gradient: AppBrand.bubbleGradient,
            shape: BoxShape.circle,
            boxShadow: [
              BoxShadow(
                color: AppBrand.violet.withValues(alpha: 0.45),
                blurRadius: 16,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: Stack(
            children: [
              const Center(
                child: Icon(
                  FLucideIcons.arrowDown,
                  size: 22,
                  color: Colors.white,
                ),
              ),
              if (newCount > 0)
                Positioned(
                  right: 0,
                  top: 0,
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: context.theme.colors.destructive,
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(
                        color: context.theme.colors.background,
                        width: 1.5,
                      ),
                    ),
                    constraints: const BoxConstraints(minWidth: 18),
                    child: Text(
                      '$newCount',
                      textAlign: TextAlign.center,
                      style: context.theme.typography.body.xs.copyWith(
                        color: Colors.white,
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The composer: rounded multi-line input with a morphing gradient
/// send button; typing pulses ride `onTyping`.
class _ComposerBar extends StatelessWidget {
  const _ComposerBar({
    required this.controller,
    required this.onTyping,
    required this.onSend,
  });

  final TextEditingController controller;
  final void Function(String text) onTyping;
  final Future<void> Function() onSend;

  @override
  Widget build(BuildContext context) {
    final theme = context.theme;
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 6, 12, 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: Container(
                decoration: BoxDecoration(
                  color: theme.colors.card,
                  borderRadius: BorderRadius.circular(24),
                  border: Border.all(color: theme.colors.border),
                  boxShadow: [
                    BoxShadow(
                      color: theme.colors.background.withValues(alpha: 0.9),
                      blurRadius: 12,
                      offset: const Offset(0, 4),
                    ),
                  ],
                ),
                child: TextField(
                  controller: controller,
                  onChanged: onTyping,
                  maxLines: 5,
                  minLines: 1,
                  textInputAction: TextInputAction.newline,
                  style: theme.typography.body.md
                      .copyWith(height: 1.35, color: theme.colors.foreground),
                  decoration: InputDecoration(
                    hintText: 'Nhập tin nhắn…',
                    hintStyle: theme.typography.body.md.copyWith(
                      color: theme.colors.mutedForeground,
                    ),
                    border: InputBorder.none,
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 13,
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            ValueListenableBuilder<TextEditingValue>(
              valueListenable: controller,
              builder: (context, value, _) {
                final enabled = value.text.trim().isNotEmpty;
                return Padding(
                  padding: const EdgeInsets.only(bottom: 2),
                  child: _SendButton(
                    enabled: enabled,
                    onTap: enabled ? onSend : null,
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

/// Circular send button: muted glass when idle, violet gradient with a
/// glow once there's text; the icon scale-rotates across the switch.
class _SendButton extends StatelessWidget {
  const _SendButton({required this.enabled, required this.onTap});

  final bool enabled;
  final Future<void> Function()? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = context.theme;
    return Semantics(
      button: true,
      enabled: enabled,
      label: 'Gửi tin nhắn',
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: AppMotion.quick,
          curve: AppMotion.easeOutCubic,
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            gradient: enabled ? AppBrand.bubbleGradient : null,
            color: enabled ? null : theme.colors.muted,
            shape: BoxShape.circle,
            boxShadow: [
              if (enabled)
                BoxShadow(
                  color: AppBrand.violet.withValues(alpha: 0.45),
                  blurRadius: 14,
                  offset: const Offset(0, 5),
                ),
            ],
          ),
          child: Center(
            child: AnimatedSwitcher(
              duration: AppMotion.quick,
              switchInCurve: AppMotion.overshoot,
              child: Icon(
                FLucideIcons.sendHorizontal,
                key: ValueKey(enabled),
                size: 20,
                color: enabled
                    ? Colors.white
                    : theme.colors.mutedForeground,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
