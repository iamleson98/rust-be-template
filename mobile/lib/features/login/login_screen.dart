import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:forui/forui.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/env.dart';

/// Staff login: employee/admin credentials against
/// `POST /api/auth/employee-login` + the backend server address (first
/// run). The server URL is persisted; `--dart-define=API_BASE_URL` locks
/// it for managed deployments.
///
/// Layout: gradient brand hero (logo mark + product name), then a card
/// with the sign-in form, then a quiet footer. The card slides up over
/// the hero's rounded bottom edge for a modern, layered look.
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
                  child: FCard(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(20, 22, 20, 20),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            'Đăng nhập nhân viên hỗ trợ',
                            textAlign: TextAlign.center,
                            style: theme.typography.display.sm.copyWith(
                              fontWeight: FontWeight.w700,
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
                            hint: 'you@datxevui.vn',
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
                      Text(
                        cfg.baseUrl,
                        style: theme.typography.body.sm.copyWith(
                          color: theme.colors.mutedForeground,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'DatXeVui Tổng đài • v0.1.0',
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

/// Gradient brand header with the headset logo mark.
class _Hero extends StatelessWidget {
  const _Hero({required this.theme});

  final FThemeData theme;

  @override
  Widget build(BuildContext context) {
    final fg = theme.colors.background;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.only(top: 72, bottom: 76),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            theme.colors.primary,
            Color.alphaBlend(
              theme.colors.primary.withValues(alpha: 0.6),
              theme.colors.background,
            ),
          ],
        ),
        borderRadius: const BorderRadius.vertical(
          bottom: Radius.circular(32),
        ),
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
              FLucideIcons.headphones,
              size: 40,
              color: fg,
            ),
          ),
          const SizedBox(height: 18),
          Text(
            'DatXeVui Tổng đài',
            style: theme.typography.display.lg.copyWith(
              fontWeight: FontWeight.w700,
              color: fg,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Trung tâm hỗ trợ khách hàng',
            style: theme.typography.body.md.copyWith(
              color: fg.withValues(alpha: 0.85),
            ),
          ),
        ],
      ),
    );
  }
}
