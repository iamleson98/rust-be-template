import 'package:material_ui/material_ui.dart';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:forui/forui.dart';
import 'package:go_router/go_router.dart';

import '../core/design.dart';
import '../features/chat/conversations_controller.dart';

/// Outer scaffold for the three-branch shell: a plain tab bar like the
/// website's phone tab bar — white, a hairline on top, icon over label,
/// the active tab in the brand blue, unread messages as a count badge.
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

    return Scaffold(
      backgroundColor: theme.colors.background,
      body: shell,
      bottomNavigationBar: DecoratedBox(
        decoration: BoxDecoration(
          color: theme.colors.card,
          border: Border(top: BorderSide(color: theme.colors.border)),
        ),
        child: SafeArea(
          top: false,
          child: SizedBox(
            height: 56,
            child: Row(
              children: [
                for (final (i, (icon, label)) in _items.indexed)
                  Expanded(
                    child: _NavItem(
                      icon: icon,
                      label: label,
                      badge: i == 0 ? unread : 0,
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
          ),
        ),
      ),
    );
  }
}

/// One tab: icon over label, with an optional count badge on the icon.
class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.icon,
    required this.label,
    required this.badge,
    required this.selected,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final int badge;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = context.theme;
    final fg = selected ? theme.colors.primary : theme.colors.mutedForeground;

    return Semantics(
      button: true,
      selected: selected,
      label: badge > 0 ? '$label, $badge tin chưa đọc' : label,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                AnimatedContainer(
                  duration: AppMotion.quick,
                  curve: Curves.easeOut,
                  width: 52,
                  height: 28,
                  decoration: BoxDecoration(
                    color: selected
                        ? theme.colors.primary.withValues(alpha: 0.10)
                        : Colors.transparent,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  alignment: Alignment.center,
                  child: Icon(icon, size: 20, color: fg),
                ),
                if (badge > 0)
                  Positioned(
                    top: -3,
                    right: 4,
                    child: Container(
                      constraints: const BoxConstraints(minWidth: 18),
                      height: 18,
                      padding: const EdgeInsets.symmetric(horizontal: 5),
                      decoration: BoxDecoration(
                        color: theme.colors.destructive,
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(color: theme.colors.card, width: 2),
                      ),
                      alignment: Alignment.center,
                      child: Text(
                        badge > 99 ? '99+' : '$badge',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                          height: 1,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 3),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.typography.body.xs.copyWith(
                color: fg,
                fontSize: 11,
                fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
