import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:forui/forui.dart';
import 'package:go_router/go_router.dart';

import '../../shared/widgets.dart';
import '../call/call_controller.dart';
import '../notifications/notification_service.dart';
import 'conversations_controller.dart';
import 'models.dart';
import 'rooms_controller.dart';

/// The 1:1 chat room: live messages over WS, optimistic sends over REST,
/// typing indicators, presence, claim/close actions, and one-tap call.
class RoomScreen extends ConsumerStatefulWidget {
  const RoomScreen({required this.channelId, super.key});

  final String channelId;

  @override
  ConsumerState<RoomScreen> createState() => _RoomScreenState();
}

class _RoomScreenState extends ConsumerState<RoomScreen> {
  final _composer = TextEditingController();
  final _scroll = ScrollController();
  int _lastCount = 0;

  @override
  void initState() {
    super.initState();
    Future(() {
      ref.read(roomsProvider.notifier).open(widget.channelId);
      ref.read(activeRoomIdProvider.notifier).set(widget.channelId);
      ref.read(notificationServiceProvider).clearChannel(widget.channelId);
    });
  }

  @override
  void dispose() {
    ref.read(activeRoomIdProvider.notifier).set(null);
    ref.read(roomsProvider.notifier).close(widget.channelId);
    _composer.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _jumpToBottom() {
    if (!_scroll.hasClients) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(
          _scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOutCubic,
        );
      }
    });
  }

  Future<void> _send() async {
    final text = _composer.text;
    if (text.trim().isEmpty) return;
    _composer.clear();
    await ref.read(roomsProvider.notifier).send(widget.channelId, text);
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
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                channel.displayName,
                style: theme.typography.display.lg
                    .copyWith(fontWeight: FontWeight.w700),
              ),
            ),
            if (channel.customer?.email != null)
              _sheetRow(FLucideIcons.mail, channel.customer!.email!),
            if (channel.customer?.phone != null)
              _sheetRow(FLucideIcons.phone, channel.customer!.phone!),
            const Divider(height: 1),
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
            const SizedBox(height: 12),
          ],
        ),
      ),
    );
  }

  Widget _sheetRow(IconData icon, String text) {
    final theme = context.theme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
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
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
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
      variant: error == null ? FToastVariant.primary : FToastVariant.destructive,
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

    // Auto-scroll when new messages land (incl. our optimistic ones).
    if (messages.length != _lastCount) {
      _lastCount = messages.length;
      _jumpToBottom();
    }

    return FScaffold(
      header: FHeader.nested(
        title: Text(channel?.displayName ?? 'Hội thoại'),
        prefixes: [FHeaderAction.back(onPress: () => context.pop())],
        suffixes: [
          if (channel != null && !channel.isClosed)
            FHeaderAction(
              icon: const Icon(FLucideIcons.phone),
              onPress: () => _startCall(channel),
            ),
          FHeaderAction(
            icon: const Icon(FLucideIcons.settings),
            onPress: () => channel == null ? null : _openActions(channel),
          ),
        ],
      ),
      child: Column(
        children: [
          if (channel != null && channel.isOpen && !channel.assignedToMe)
            _claimBar(context),
          if (room?.error != null) _errorBar(context, room!.error!),
          Expanded(
            child: room == null || room.loading
                ? const Center(child: CircularProgressIndicator())
                : messages.isEmpty
                    ? EmptyState(
                        icon: FLucideIcons.messageSquare,
                        title: 'Chưa có tin nhắn',
                        message: 'Hãy gửi lời chào để bắt đầu hỗ trợ.',
                      )
                    : _MessageList(
                        messages: messages,
                        scroll: _scroll,
                        onRetry: (clientMsgId) => ref
                            .read(roomsProvider.notifier)
                            .retry(widget.channelId, clientMsgId),
                      ),
          ),
          if (room?.typingName != null)
            _typingBar(context, room!.typingName!),
          _composerBar(context),
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
        style: theme.typography.body.sm.copyWith(color: theme.colors.destructive),
      ),
    );
  }

  Widget _typingBar(BuildContext context, String name) {
    final theme = context.theme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
      child: Row(
        children: [
          TypingIndicator(),
          const SizedBox(width: 8),
          Text(
            '$name đang nhập…',
            style: theme.typography.body.sm
                .copyWith(color: theme.colors.mutedForeground),
          ),
        ],
      ),
    );
  }

  Widget _composerBar(BuildContext context) {
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: FTextField(
                control: FTextFieldControl.managed(
                  controller: _composer,
                  onChange: (value) => ref
                      .read(roomsProvider.notifier)
                      .typing(widget.channelId, value.text.isNotEmpty),
                ),
                hint: 'Nhập tin nhắn…',
                maxLines: 3,
                textInputAction: TextInputAction.newline,
                onSubmit: (value) {
                  if (value.trim().isNotEmpty) _send();
                },
              ),
            ),
            const SizedBox(width: 8),
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: FButton.icon(
                variant: FButtonVariant.primary,
                onPress: _composer.text.trim().isEmpty ? null : _send,
                child: const Icon(FLucideIcons.send),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Chronological message list with bubbles.
class _MessageList extends StatelessWidget {
  const _MessageList({
    required this.messages,
    required this.scroll,
    required this.onRetry,
  });

  final List<ChatMessage> messages;
  final ScrollController scroll;
  final void Function(String clientMsgId) onRetry;

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      controller: scroll,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      itemCount: messages.length,
      itemBuilder: (context, i) => _bubble(context, messages[i]),
    );
  }

  Widget _bubble(BuildContext context, ChatMessage m) {
    final theme = context.theme;

    // System / assistant (NullClaw bot) messages: centered meta rows.
    if (m.isSystem) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          children: [
            const Expanded(child: Divider()),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: Text(
                m.senderType == 'assistant'
                    ? '🤖 ${m.senderName ?? 'Trợ lý'}: ${m.content ?? ''}'
                    : m.content ?? '',
                textAlign: TextAlign.center,
                style: theme.typography.body.sm.copyWith(
                  color: theme.colors.mutedForeground,
                ),
              ),
            ),
            const Expanded(child: Divider()),
          ],
        ),
      );
    }

    final mine = m.isMe;
    final failed = m.sendState == SendState.failed;
    final sending = m.sendState == SendState.sending;

    final bubble = GestureDetector(
      onTap: failed && m.clientMsgId != null ? () => onRetry(m.clientMsgId!) : null,
      child: Opacity(
        opacity: sending ? 0.6 : 1,
        child: Container(
          constraints: const BoxConstraints(maxWidth: 320),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: failed
                ? theme.colors.destructive.withValues(alpha: 0.15)
                : mine
                    ? theme.colors.primary
                    : theme.colors.muted,
            borderRadius: BorderRadius.only(
              topLeft: const Radius.circular(16),
              topRight: const Radius.circular(16),
              bottomLeft: Radius.circular(mine ? 16 : 4),
              bottomRight: Radius.circular(mine ? 4 : 16),
            ),
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
                ),
              ),
              const SizedBox(height: 2),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (failed)
                    Icon(FLucideIcons.circleAlert,
                        size: 12, color: theme.colors.destructive)
                  else if (sending)
                    Icon(FLucideIcons.timer,
                        size: 12, color: theme.colors.mutedForeground),
                  if (failed) const SizedBox(width: 4),
                  Text(
                    formatBubbleTime(m.createdAt),
                    style: theme.typography.body.sm.copyWith(
                      fontSize: 11,
                      color: mine
                          ? theme.colors.primaryForeground.withValues(alpha: 0.7)
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

    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: bubble,
      ),
    );
  }
}
