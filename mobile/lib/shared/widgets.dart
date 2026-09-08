import 'package:material_ui/material_ui.dart';
import 'package:forui/forui.dart';
import 'package:intl/intl.dart';

import '../core/design.dart';

/// Parses the backend's ISO-8601 UTC timestamps (second precision),
/// returning null for unparseable input instead of throwing.
DateTime? parseIso(String? iso) {
  if (iso == null || iso.isEmpty) return null;
  return DateTime.tryParse(iso)?.toLocal();
}

/// Compact timestamp for conversation rows:
/// `HH:mm` today, `dd/MM` this year, `dd/MM/yy` older.
String formatListTime(String? iso) {
  final dt = parseIso(iso);
  if (dt == null) return '';
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  if (dt.isAfter(today)) return DateFormat('HH:mm').format(dt);
  if (dt.year == now.year) return DateFormat('dd/MM').format(dt);
  return DateFormat('dd/MM/yy').format(dt);
}

/// `HH:mm` for chat bubbles.
String formatBubbleTime(String? iso) {
  final dt = parseIso(iso);
  if (dt == null) return '';
  return DateFormat('HH:mm').format(dt);
}

/// Vietnamese day-divider label: `Hôm nay`, `Hôm qua`,
/// `Thứ N, dd tháng M` this year, `dd tháng M yyyy` otherwise.
String formatDayLabel(DateTime day) {
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final yesterday = today.subtract(const Duration(days: 1));
  final d = DateTime(day.year, day.month, day.day);
  if (d == today) return 'Hôm nay';
  if (d == yesterday) return 'Hôm qua';
  const weekdays = [
    'Chủ nhật',
    'Thứ hai',
    'Thứ ba',
    'Thứ tư',
    'Thứ năm',
    'Thứ sáu',
    'Thứ bảy',
  ];
  final label = DateFormat("d 'tháng' M").format(d);
  if (d.year == now.year) {
    final diff = today.difference(d).inDays;
    // Recent week: name the weekday for quick orientation.
    if (diff < 7) return '${weekdays[d.weekday % 7]}, $label';
    return label;
  }
  return DateFormat("d 'tháng' M yyyy").format(d);
}

/// Vietnamese relative time: `vừa xong`, `n phút trước`, `Hôm qua`,
/// falling back to a compact date.
String formatRelative(String? iso) {
  final dt = parseIso(iso);
  if (dt == null) return '';
  final diff = DateTime.now().difference(dt);
  if (diff.inSeconds < 60) return 'vừa xong';
  if (diff.inMinutes < 60) return '${diff.inMinutes} phút trước';
  if (diff.inHours < 24) return '${diff.inHours} giờ trước';
  if (diff.inDays == 1) return 'Hôm qua';
  return formatListTime(iso);
}

/// `mm:ss` for the active call duration.
String formatCallDuration(Duration d) {
  final m = d.inMinutes.remainder(60).toString().padLeft(2, '0');
  final s = d.inSeconds.remainder(60).toString().padLeft(2, '0');
  return '$m:$s';
}

/// Circular avatar: network image when available, otherwise initials on
/// a deterministic purple-family gradient (stable per name).
class AgentAvatar extends StatelessWidget {
  const AgentAvatar({
    required this.name,
    this.imageUrl,
    this.size = 40,
    this.foregroundColor = Colors.white,
    super.key,
  });

  final String name;
  final String? imageUrl;
  final double size;

  /// Initials/text color on the gradient fallback.
  final Color? foregroundColor;

  String get _initials {
    final parts =
        name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
    return (parts.first.substring(0, 1) + parts.last.substring(0, 1))
        .toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    if (imageUrl != null && imageUrl!.isNotEmpty) {
      return CircleAvatar(
        radius: size / 2,
        backgroundImage: NetworkImage(imageUrl!),
        onBackgroundImageError: (_, __) {},
      );
    }
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: AppBrand.avatarColors(name),
        ),
      ),
      alignment: Alignment.center,
      child: Text(
        _initials,
        style: TextStyle(
          color: foregroundColor,
          fontSize: size * 0.34,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.3,
        ),
      ),
    );
  }
}

/// Green/gray presence dot with a background ring (for avatar stacks).
class PresenceDot extends StatelessWidget {
  const PresenceDot({required this.online, this.size = 10, super.key});

  final bool online;
  final double size;

  @override
  Widget build(BuildContext context) {
    final theme = context.theme;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: online ? AppBrand.success : theme.colors.mutedForeground,
        border: Border.all(
          color: theme.colors.background,
          width: size * 0.18,
        ),
        boxShadow: [
          BoxShadow(
            color: online
                ? AppBrand.success.withValues(alpha: 0.45)
                : Colors.transparent,
            blurRadius: size * 0.6,
          ),
        ],
      ),
    );
  }
}

/// Animated "typing…" indicator (three wave-pulsing dots in brand color).
class TypingIndicator extends StatefulWidget {
  const TypingIndicator({this.color, super.key});

  final Color? color;

  @override
  State<TypingIndicator> createState() => _TypingIndicatorState();
}

class _TypingIndicatorState extends State<TypingIndicator>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = widget.color ?? context.theme.colors.primary;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(3, (i) {
        return AnimatedBuilder(
          animation: _controller,
          builder: (context, _) {
            final double phase =
                (_controller.value * 3 - i).clamp(0.0, 1.0).toDouble();
            final double wave =
                (1 - (phase - 0.5).abs() * 2).clamp(0.0, 1.0).toDouble();
            final double scale = 0.7 + 0.3 * wave;
            return Container(
              margin: const EdgeInsets.symmetric(horizontal: 2),
              width: 7 * scale,
              height: 7 * scale,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: color.withValues(alpha: 0.45 + 0.55 * wave),
              ),
            );
          },
        );
      }),
    );
  }
}

/// Friendly empty/error placeholder for lists — brand-tinted glyph.
class EmptyState extends StatelessWidget {
  const EmptyState({
    required this.icon,
    required this.title,
    required this.message,
    this.onRetry,
    super.key,
  });

  final IconData icon;
  final String title;
  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = context.theme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 84,
              height: 84,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: theme.colors.primary.withValues(alpha: 0.10),
              ),
              alignment: Alignment.center,
              child: Icon(
                icon,
                size: 38,
                color: theme.colors.primary,
              ),
            ),
            const SizedBox(height: 16),
            Text(
              title,
              textAlign: TextAlign.center,
              style: theme.typography.display.lg.copyWith(
                fontWeight: FontWeight.w700,
                color: theme.colors.foreground,
                letterSpacing: -0.3,
              ),
            ),
            const SizedBox(height: 6),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 300),
              child: Text(
                message,
                textAlign: TextAlign.center,
                style: theme.typography.body.sm.copyWith(
                  color: theme.colors.mutedForeground,
                  height: 1.4,
                ),
              ),
            ),
            if (onRetry != null) ...[
              const SizedBox(height: 18),
              FButton(
                variant: FButtonVariant.outline,
                size: FButtonSizeVariant.sm,
                onPress: onRetry,
                child: const Text('Thử lại'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Pulsing ring around the call avatar.
class PulsingAvatar extends StatefulWidget {
  const PulsingAvatar({
    required this.child,
    required this.pulse,
    super.key,
  });

  final Widget child;
  final bool pulse;

  @override
  State<PulsingAvatar> createState() => _PulsingAvatarState();
}

class _PulsingAvatarState extends State<PulsingAvatar>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  );

  @override
  void initState() {
    super.initState();
    if (widget.pulse) _controller.repeat(reverse: true);
  }

  @override
  void didUpdateWidget(PulsingAvatar old) {
    super.didUpdateWidget(old);
    if (widget.pulse && !_controller.isAnimating) {
      _controller.repeat(reverse: true);
    } else if (!widget.pulse && _controller.isAnimating) {
      _controller.stop();
      _controller.value = 0;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final scale = 1 + 0.08 * _controller.value;
        final opacity = 0.5 * (1 - _controller.value);
        return Stack(
          alignment: Alignment.center,
          children: [
            Transform.scale(
              scale: scale,
              child: Opacity(
                opacity: widget.pulse ? opacity : 0,
                child: Container(
                  width: 116,
                  height: 116,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: AppBrand.violet.withValues(alpha: 0.35),
                  ),
                ),
              ),
            ),
            child!,
          ],
        );
      },
      child: widget.child,
    );
  }
}
