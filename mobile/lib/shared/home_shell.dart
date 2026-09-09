import 'package:material_ui/material_ui.dart';
import 'dart:ui';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:forui/forui.dart';
import 'package:go_router/go_router.dart';

import '../core/design.dart';
import '../features/chat/conversations_controller.dart';

/// Outer scaffold for the three-branch shell.
///
/// Signature element: a floating glassy pill bottom bar (Messenger-style)
/// — backdrop blur, soft shadow, and a sliding purple selection pill
/// that glides between tabs instead of an abrupt color swap. Branch
/// content fades through when switching (see the router's fade-through
/// page transitions).
class HomeShell extends ConsumerWidget {
  const HomeShell({required this.shell, super.key});

  final StatefulNavigationShell shell;

  static const _items = [
    (FLucideIcons.messagesSquare, 'Hỗ trợ'),
    (FLucideIcons.users, 'Đội ngũ'),
    (FLucideIcons.settings, 'Cài đặt'),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = context.theme;
    final unread = ref.watch(totalUnreadProvider);
    final index = shell.currentIndex;
    final count = _items.length;

    return Scaffold(
      backgroundColor: theme.colors.background,
      extendBody: true,
      body: shell,
      bottomNavigationBar: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 16, sigmaY: 16),
              child: Container(
                height: 60,
                decoration: BoxDecoration(
                  color: theme.colors.card.withValues(alpha: 0.84),
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(
                    color: theme.colors.border.withValues(alpha: 0.7),
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: theme.colors.background.withValues(alpha: 0.55),
                      blurRadius: 18,
                      offset: const Offset(0, 6),
                    ),
                    BoxShadow(
                      color: AppBrand.violet.withValues(alpha: 0.10),
                      blurRadius: 30,
                      offset: const Offset(0, 10),
                    ),
                  ],
                ),
                // Stack paints first → last; the pill is first so it sits
                // BEHIND the items.
                child: Stack(
                  children: [
                    _SelectionPill(index: index, count: count),
                    Row(
                      children: [
                        for (final (i, (icon, label)) in _items.indexed)
                          Expanded(
                            child: _NavItem(
                              icon: icon,
                              label: i == 0 && unread > 0
                                  ? 'Hỗ trợ · $unread'
                                  : label,
                              selected: index == i,
                              onTap: () => shell.goBranch(
                                i,
                                // Tapping the current tab resets the branch
                                // (pops room → queue).
                                initialLocation: i == index,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// One nav item: icon + label, colored for the active pill underneath.
///
/// All color/weight/scale changes are animated so the active state reads
/// clearly (bold, white) without an abrupt hard cut when switching tabs.
class _NavItem extends StatefulWidget {
  const _NavItem({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  State<_NavItem> createState() => _NavItemState();
}

class _NavItemState extends State<_NavItem> {
  bool _pressed = false;

  void _setPressed(bool value) {
    if (_pressed == value) return;
    setState(() => _pressed = value);
  }

  @override
  Widget build(BuildContext context) {
    final theme = context.theme;
    final selected = widget.selected;
    final fg = selected
        ? theme.colors.primaryForeground
        : theme.colors.mutedForeground;

    return Semantics(
      button: true,
      selected: selected,
      label: widget.label,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: widget.onTap,
        onTapDown: (_) => _setPressed(true),
        onTapCancel: () => _setPressed(false),
        onTapUp: (_) => _setPressed(false),
        child: AnimatedScale(
          scale: _pressed ? 0.92 : 1,
          duration: AppMotion.quick,
          curve: Curves.easeOut,
          child: SizedBox(
            height: 60,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                AnimatedScale(
                  scale: selected ? 1.08 : 1,
                  duration: AppMotion.page,
                  curve: AppMotion.overshoot,
                  child: AnimatedSwitcher(
                    duration: AppMotion.quick,
                    child: Icon(
                      widget.icon,
                      key: ValueKey(selected),
                      size: 19,
                      color: fg,
                    ),
                  ),
                ),
                const SizedBox(width: 5),
                Flexible(
                  child: AnimatedDefaultTextStyle(
                    duration: AppMotion.page,
                    curve: Curves.easeOut,
                    style: theme.typography.body.xs.copyWith(
                      color: fg,
                      fontWeight:
                          selected ? FontWeight.w700 : FontWeight.w500,
                      fontSize: 11,
                      letterSpacing: -0.1,
                    ),
                    child: Text(
                      widget.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Purple gradient pill that glides behind the active tab with a light
/// overshoot — the bar's signature motion.
class _SelectionPill extends StatelessWidget {
  const _SelectionPill({required this.index, required this.count});

  final int index;
  final int count;

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: LayoutBuilder(
        builder: (context, constraints) {
          final w = constraints.maxWidth / count;
          final pillWidth = w * 0.86;
          return Stack(
            children: [
              AnimatedPositioned(
                duration: AppMotion.page,
                curve: AppMotion.overshoot,
                // Slot left edge + half the leftover slot space centers
                // the (narrower) pill exactly under the active tab.
                left: index * w + (w - pillWidth) / 2,
                top: 8,
                width: pillWidth,
                height: 44,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: AppBrand.bubbleGradient,
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.18),
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: AppBrand.violet.withValues(alpha: 0.42),
                        blurRadius: 14,
                        offset: const Offset(0, 5),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
