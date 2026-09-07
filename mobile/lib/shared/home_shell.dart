import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:forui/forui.dart';
import 'package:go_router/go_router.dart';

import '../features/chat/conversations_controller.dart';

/// Outer scaffold for the three-branch shell: single bottom navigation
/// bar, branch content fills the body. Each branch screen brings its own
/// `FScaffold` header; this shell only owns the footer.
class HomeShell extends ConsumerWidget {
  const HomeShell({required this.shell, super.key});

  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unread = ref.watch(totalUnreadProvider);

    return FScaffold(
      footer: FBottomNavigationBar(
        safeAreaBottom: true,
        index: shell.currentIndex,
        onChange: (index) => shell.goBranch(
          index,
          // Tapping the current tab resets the branch (pops room → queue).
          initialLocation: index == shell.currentIndex,
        ),
        children: [
          FBottomNavigationBarItem(
            icon: const Icon(FLucideIcons.messagesSquare),
            label: Text(unread > 0 ? 'Hỗ trợ · $unread' : 'Hỗ trợ'),
          ),
          const FBottomNavigationBarItem(
            icon: Icon(FLucideIcons.users),
            label: Text('Đội ngũ'),
          ),
          const FBottomNavigationBarItem(
            icon: Icon(FLucideIcons.settings),
            label: Text('Cài đặt'),
          ),
        ],
      ),
      child: shell,
    );
  }
}
