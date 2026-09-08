import 'package:material_ui/material_ui.dart';
import 'package:forui/forui.dart';

/// Branded cold-start screen.
///
/// Shown while the persisted session is being restored from the
/// keystore and validated (auto-login). Never lingers: the router
/// redirects the moment `AuthState.restored` flips.
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = context.theme;
    return Scaffold(
      backgroundColor: theme.colors.background,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _LogoMark(size: 88),
            const SizedBox(height: 24),
            Text(
              'DatXeVui Tổng đài',
              style: theme.typography.display.lg.copyWith(
                fontWeight: FontWeight.w700,
                color: theme.colors.foreground,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Đang đăng nhập…',
              style: theme.typography.body.sm.copyWith(
                color: theme.colors.mutedForeground,
              ),
            ),
            const SizedBox(height: 28),
            SizedBox(
              width: 26,
              height: 26,
              child: CircularProgressIndicator(
                strokeWidth: 2.4,
                color: theme.colors.primary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Circular brand mark — headset glyph over the brand gradient.
class _LogoMark extends StatelessWidget {
  const _LogoMark({this.size = 72});

  final double size;

  @override
  Widget build(BuildContext context) {
    final theme = context.theme;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            theme.colors.primary,
            Color.alphaBlend(
              theme.colors.primary.withValues(alpha: 0.55),
              theme.colors.background,
            ),
          ],
        ),
        borderRadius: BorderRadius.circular(size * 0.3),
        boxShadow: [
          BoxShadow(
            color: theme.colors.primary.withValues(alpha: 0.35),
            blurRadius: 24,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Icon(
        FLucideIcons.headphones,
        size: size * 0.5,
        color: theme.colors.background,
      ),
    );
  }
}
