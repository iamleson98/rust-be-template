import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:forui/forui.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/env.dart';
import '../../core/router.dart';

/// Staff login: employee/admin credentials against
/// `POST /api/auth/employee-login` + the backend server address (first
/// run). The server URL is persisted; `--dart-define=API_BASE_URL` locks
/// it for managed deployments.
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
    ref.read(routerProvider).go('/chat');
  }

  @override
  Widget build(BuildContext context) {
    final theme = context.theme;
    final cfg = ref.watch(appConfigProvider);

    return FScaffold(
      header: FHeader(
        title: const Text('VeXeVN Tổng đài'),
        suffixes: [
          FHeaderAction(
            icon: const Icon(FLucideIcons.settings),
            onPress: () =>
                setState(() => _showServer = !_showServer),
          ),
        ],
      ),
      child: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 440),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: FCard(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Icon(
                        FLucideIcons.headphones,
                        size: 40,
                        color: theme.colors.primary,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Đăng nhập nhân viên hỗ trợ',
                        textAlign: TextAlign.center,
                        style: theme.typography.display.lg.copyWith(
                          fontWeight: FontWeight.w700,
                          color: theme.colors.foreground,
                        ),
                      ),
                      const SizedBox(height: 20),
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
                        control: FTextFieldControl.managed(controller: _email),
                        label: const Text('Email'),
                        hint: 'you@vexevn.vn',
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
                      const SizedBox(height: 20),
                      FButton(
                        onPress: _busy ? null : _submit,
                        child: _busy
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Text('Đăng nhập'),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        'Máy chủ: ${cfg.baseUrl}',
                        textAlign: TextAlign.center,
                        style: theme.typography.body.sm.copyWith(
                          color: theme.colors.mutedForeground,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
