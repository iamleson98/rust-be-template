import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:forui/forui.dart';

import '../../core/design.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/env.dart';

/// Staff login: employee/admin credentials against
/// `POST /api/auth/employee-login` + the backend server address (first
/// run). The server URL is persisted; `--dart-define=API_BASE_URL` locks
/// it for managed deployments.
///
/// Layout: violet→fuchsia gradient hero (taxi logo mark + "đặt xe vui"
/// wordmark), then the sign-in card slides over the hero's rounded
/// bottom edge, then a quiet footer.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _server = TextEditingController();
  bool _busy = false;
  bool _showServer = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final url = ref.read(appConfigProvider).baseUrl;
    _server.text = url;
    // Surface the editor when pointing at the dev default — the agent
    // most likely needs to enter the real address.
    _showServer = url.contains('10.0.2.2') || url.contains('localhost');
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _server.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    final server = _server.text.trim();
    if (server.isNotEmpty && server != ref.read(appConfigProvider).baseUrl) {
      await ref.read(appConfigProvider.notifier).setServerUrl(server);
    }
    final email = _email.text.trim();
    final password = _password.text;
    if (email.isEmpty || password.isEmpty) {
      setState(() => _error = 'Vui lòng nhập email và mật khẩu');
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
    });
    final error = await ref.read(authControllerProvider.notifier).login(
          email: email,
          password: password,
        );
    if (!mounted) return;
    if (error != null) {
      setState(() {
        _busy = false;
        _error = error;
      });
      return;
    }
    // Auth state flips → router redirect handles the move to /chat.
  }

  @override
  Widget build(BuildContext context) {
    final theme = context.theme;
    final cfg = ref.watch(appConfigProvider);

    return Scaffold(
      backgroundColor: theme.colors.background,
      body: SingleChildScrollView(
        // Keep the form reachable on small keyboards/screens.
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        child: Column(
          children: [
            _Hero(theme: theme),
            // Card overlaps the hero's bottom edge.
            Transform.translate(
              offset: const Offset(0, -44),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 460),
                  child: Container(
                    decoration: BoxDecoration(
                      color: theme.colors.card,
                      borderRadius: BorderRadius.circular(24),
                      border: Border.all(
                        color: theme.colors.border.withValues(alpha: 0.8),
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: AppBrand.violet.withValues(alpha: 0.16),
                          blurRadius: 32,
                          offset: const Offset(0, 14),
                        ),
                      ],
                    ),
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(20, 22, 20, 20),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            'Đăng nhập nhân viên hỗ trợ',
                            textAlign: TextAlign.center,
                            style: theme.typography.display.sm.copyWith(
                              fontWeight: FontWeight.w800,
                              letterSpacing: -0.4,
                              color: theme.colors.foreground,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'Nhận và trả lời tin nhắn, cuộc gọi của khách',
                            textAlign: TextAlign.center,
                            style: theme.typography.body.sm.copyWith(
                              color: theme.colors.mutedForeground,
                            ),
                          ),
                          const SizedBox(height: 22),
                          if (_showServer) ...[
                            FTextField(
                              control: FTextFieldControl.managed(
                                controller: _server,
                              ),
                              label: const Text('Địa chỉ máy chủ'),
                              hint: 'https://api.datxevui.com',
                              textInputAction: TextInputAction.next,
                            ),
                            const SizedBox(height: 12),
                          ],
                          FTextField.email(
                            control:
                                FTextFieldControl.managed(controller: _email),
                            label: const Text('Email'),
                            hint: 'you@datxevui.com',
                            textInputAction: TextInputAction.next,
                          ),
                          const SizedBox(height: 12),
                          FTextField(
                            control:
                                FTextFieldControl.managed(controller: _password),
                            label: const Text('Mật khẩu'),
                            hint: '••••••••',
                            obscureText: true,
                            textInputAction: TextInputAction.done,
                            onSubmit: (_) => _submit(),
                          ),
                          if (_error != null) ...[
                            const SizedBox(height: 12),
                            FAlert(
                              variant: FAlertVariant.destructive,
                              title: Text(_error!),
                            ),
                          ],
                          const SizedBox(height: 22),
                          _LoginButton(busy: _busy, onSubmit: _submit),
                          const SizedBox(height: 14),
                          // Server quick-toggle row.
                          Center(
                            child: FButton.raw(
                              onPress: () =>
                                  setState(() => _showServer = !_showServer),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(
                                    _showServer
                                        ? FLucideIcons.chevronUp
                                        : FLucideIcons.chevronDown,
                                    size: 14,
                                    color: theme.colors.mutedForeground,
                                  ),
                                  const SizedBox(width: 4),
                                  Text(
                                    _showServer
                                        ? 'Ẩn máy chủ'
                                        : 'Đổi máy chủ',
                                    style: theme.typography.body.sm.copyWith(
                                      color: theme.colors.mutedForeground,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
            // Footer.
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
              child: Column(
                children: [
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        FLucideIcons.server,
                        size: 12,
                        color: theme.colors.mutedForeground,
                      ),
                      const SizedBox(width: 4),
                      Flexible(
                        child: Text(
                          cfg.baseUrl,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: theme.typography.body.sm.copyWith(
                            color: theme.colors.mutedForeground,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'đặt xe vui • v0.1.0',
                    style: theme.typography.body.sm.copyWith(
                      color: theme.colors.mutedForeground,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Gradient primary login button (forui buttons stay token-colored;
/// this one carries the brand gradient + glow).
class _LoginButton extends StatelessWidget {
  const _LoginButton({required this.busy, required this.onSubmit});

  final bool busy;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    final theme = context.theme;
    return Semantics(
      button: true,
      enabled: !busy,
      label: 'Đăng nhập',
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: busy ? null : onSubmit,
        child: Container(
          height: 50,
          decoration: BoxDecoration(
            gradient: AppBrand.heroGradient,
            borderRadius: BorderRadius.circular(14),
            boxShadow: [
              BoxShadow(
                color: AppBrand.violet.withValues(alpha: 0.42),
                blurRadius: 18,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          alignment: Alignment.center,
          child: busy
              ? SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.2,
                    color: theme.colors.primaryForeground,
                  ),
                )
              : Text(
                  'Đăng nhập',
                  style: theme.typography.body.md.copyWith(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.2,
                  ),
                ),
        ),
      ),
    );
  }
}

/// Gradient brand header with the taxi logo mark.
class _Hero extends StatelessWidget {
  const _Hero({required this.theme});

  final FThemeData theme;

  @override
  Widget build(BuildContext context) {
    final fg = Colors.white;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.only(top: 76, bottom: 76),
      decoration: const BoxDecoration(
        gradient: AppBrand.heroGradient,
        borderRadius: BorderRadius.vertical(
          bottom: Radius.circular(36),
        ),
        boxShadow: [
          BoxShadow(
            color: Color(0x337C3AED),
            blurRadius: 36,
            offset: Offset(0, 12),
          ),
        ],
      ),
      child: Column(
        children: [
          Container(
            width: 84,
            height: 84,
            decoration: BoxDecoration(
              color: fg.withValues(alpha: 0.16),
              borderRadius: BorderRadius.circular(26),
              border: Border.all(
                color: fg.withValues(alpha: 0.35),
                width: 1.2,
              ),
            ),
            child: Icon(
              FLucideIcons.carTaxiFront,
              size: 40,
              color: fg,
            ),
          ),
          const SizedBox(height: 18),
          Text(
            'đặt xe vui',
            style: theme.typography.display.xl.copyWith(
              fontWeight: FontWeight.w800,
              letterSpacing: -0.6,
              color: fg,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Tổng đài hỗ trợ khách hàng',
            style: theme.typography.body.md.copyWith(
              color: fg.withValues(alpha: 0.85),
            ),
          ),
        ],
      ),
    );
  }
}
