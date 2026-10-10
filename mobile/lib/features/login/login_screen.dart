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
/// Layout, like the website's sign-in: the logo and wordmark on the canvas,
/// one white card with the fields, and the server address folded into a
/// small toggle underneath.
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
    final error = await ref
        .read(authControllerProvider.notifier)
        .login(email: email, password: password);
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
    final host = Uri.tryParse(cfg.baseUrl)?.authority ?? cfg.baseUrl;

    return Scaffold(
      backgroundColor: theme.colors.background,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            // Keep the form reachable on small keyboards/screens.
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            padding: const EdgeInsets.fromLTRB(20, 24, 20, 24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Center(
                    child: Image.asset(
                      'assets/logo/logo-mark.png',
                      width: 64,
                      height: 64,
                      fit: BoxFit.contain,
                      excludeFromSemantics: true,
                    ),
                  ),
                  const SizedBox(height: 14),
                  Text(
                    'DatXeVui',
                    textAlign: TextAlign.center,
                    style: theme.typography.display.lg.copyWith(
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.6,
                      color: theme.colors.foreground,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Đăng nhập dành cho nhân viên hỗ trợ',
                    textAlign: TextAlign.center,
                    style: theme.typography.body.md.copyWith(
                      color: theme.colors.mutedForeground,
                    ),
                  ),
                  const SizedBox(height: 28),
                  Container(
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      color: theme.colors.card,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: theme.colors.border),
                      boxShadow: AppShadow.soft,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
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
                          control: FTextFieldControl.managed(
                            controller: _email,
                          ),
                          label: const Text('Email'),
                          hint: 'ban@datxevui.com',
                          textInputAction: TextInputAction.next,
                        ),
                        const SizedBox(height: 12),
                        FTextField(
                          control: FTextFieldControl.managed(
                            controller: _password,
                          ),
                          label: const Text('Mật khẩu'),
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
                        const SizedBox(height: 20),
                        _LoginButton(busy: _busy, onSubmit: _submit),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  // Which server the app talks to — tap to change it.
                  Center(
                    child: Semantics(
                      button: true,
                      child: GestureDetector(
                        behavior: HitTestBehavior.opaque,
                        onTap: () => setState(() => _showServer = !_showServer),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 8,
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                FLucideIcons.server,
                                size: 13,
                                color: theme.colors.mutedForeground,
                              ),
                              const SizedBox(width: 6),
                              Flexible(
                                child: Text(
                                  _showServer
                                      ? 'Ẩn máy chủ'
                                      : 'Máy chủ · $host',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: theme.typography.body.sm.copyWith(
                                    color: theme.colors.mutedForeground,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 2),
                              Icon(
                                _showServer
                                    ? FLucideIcons.chevronUp
                                    : FLucideIcons.chevronDown,
                                size: 14,
                                color: theme.colors.mutedForeground,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The primary sign-in button: solid brand blue, a spinner while busy.
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
        child: AnimatedOpacity(
          duration: AppMotion.quick,
          opacity: busy ? 0.75 : 1,
          child: Container(
            height: 48,
            decoration: BoxDecoration(
              color: theme.colors.primary,
              borderRadius: BorderRadius.circular(12),
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
                      color: theme.colors.primaryForeground,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
          ),
        ),
      ),
    );
  }
}
