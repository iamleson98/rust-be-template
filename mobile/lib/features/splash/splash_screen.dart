import 'package:material_ui/material_ui.dart';
import 'package:forui/forui.dart';

import '../../core/design.dart';

/// Branded cold-start screen.
///
/// Shown while the persisted session is being restored from the
/// keystore and validated (auto-login). Never lingers: the router
/// redirects the moment `AuthState.restored` flips.
///
/// Full-bleed violet→fuchsia gradient with the taxi logo mark, the
/// "đặt xe vui" wordmark and a soft breathing loader.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _intro = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 600),
  )..forward();

  late final Animation<double> _fade = CurvedAnimation(
    parent: _intro,
    curve: AppMotion.easeOutCubic,
  );

  @override
  void dispose() {
    _intro.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = context.theme;

    return Scaffold(
      body: Container(
        width: double.infinity,
        height: double.infinity,
        decoration: const BoxDecoration(gradient: AppBrand.heroGradient),
        child: SafeArea(
          child: Center(
            child: FadeTransition(
              opacity: _fade,
              child: ScaleTransition(
                scale: Tween(begin: 0.9, end: 1.0).animate(_fade),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    _LogoMark(size: 96),
                    const SizedBox(height: 26),
                    Text(
                      'đặt xe vui',
                      style: theme.typography.display.xl3.copyWith(
                        fontWeight: FontWeight.w800,
                        letterSpacing: -0.8,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Tổng đài hỗ trợ',
                      style: theme.typography.body.md.copyWith(
                        color: Colors.white.withValues(alpha: 0.85),
                        letterSpacing: 0.2,
                      ),
                    ),
                    const SizedBox(height: 34),
                    SizedBox(
                      width: 26,
                      height: 26,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.4,
                        color: Colors.white.withValues(alpha: 0.85),
                      ),
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

/// Rounded-square brand mark: taxi glyph on white glass over the brand
/// gradient.
class _LogoMark extends StatelessWidget {
  const _LogoMark({this.size = 72});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.18),
        borderRadius: BorderRadius.circular(size * 0.3),
        border: Border.all(
          color: Colors.white.withValues(alpha: 0.38),
          width: 1.4,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.22),
            blurRadius: 28,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Icon(
        FLucideIcons.carTaxiFront,
        size: size * 0.52,
        color: Colors.white,
      ),
    );
  }
}
