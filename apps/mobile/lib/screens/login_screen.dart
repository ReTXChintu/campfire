import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../config.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';
import '../widgets/ui_kit.dart';

enum _Mode { signIn, signUp }

/// Login, redesigned: full-bleed, a two-pane split on a desktop window (pitch on the left, form
/// on the right) and a single scrolling column on a phone — never a centred max-width card.
///
/// The password field is [PasswordField], which carries the required eye show/hide toggle with an
/// accessible label. Android TV never reaches this screen at all: `app_router.dart` sends it to
/// the pairing-code flow instead, because entering a password with a remote is miserable.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  _Mode _mode = _Mode.signIn;
  bool _submitting = false;
  String? _validation;

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  bool get _isSignUp => _mode == _Mode.signUp;

  Future<void> _submit(AuthService auth) async {
    final email = _emailController.text.trim();
    final password = _passwordController.text;
    if (email.isEmpty || password.isEmpty) {
      setState(() => _validation = 'Enter both your email and password to sign in.');
      return;
    }
    if (_isSignUp && password.length < 8) {
      setState(() => _validation = 'Pick a password of at least 8 characters.');
      return;
    }
    setState(() {
      _validation = null;
      _submitting = true;
    });
    if (_isSignUp) {
      await auth.signUp(
        email,
        password,
        _nameController.text.trim().isEmpty ? null : _nameController.text.trim(),
      );
    } else {
      await auth.signIn(email, password);
    }
    if (mounted) setState(() => _submitting = false);
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthService>();
    final width = MediaQuery.sizeOf(context).width;
    final wide = width >= 900;

    final form = _Form(
      mode: _mode,
      nameController: _nameController,
      emailController: _emailController,
      passwordController: _passwordController,
      submitting: _submitting,
      error: _validation ?? auth.error,
      onSubmit: () => _submit(auth),
      onToggleMode: () => setState(() {
        _mode = _isSignUp ? _Mode.signIn : _Mode.signUp;
        _validation = null;
        auth.error = null;
      }),
    );

    if (!wide) {
      return Scaffold(
        body: DecoratedBox(
          decoration: const BoxDecoration(
            gradient: RadialGradient(
              center: Alignment(0, -0.6),
              radius: 1.1,
              colors: [Color(0xFF3A1A12), Color(0xFF1A0E12), AppColors.background],
              stops: [0, 0.4, 0.9],
            ),
          ),
          child: SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 32, 16, 32),
              children: [
                Center(child: Image.asset('assets/images/full_logo.png', height: 132)),
                const SizedBox(height: 6),
                const Center(
                  child: Text(
                    'Your library, on your own server.',
                    style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
                  ),
                ),
                const FilmstripDivider(margin: EdgeInsets.symmetric(vertical: 24)),
                form,
              ],
            ),
          ),
        ),
      );
    }

    return Scaffold(
      body: Row(
        children: [
          Expanded(
            flex: 3,
            child: DecoratedBox(
              decoration: const BoxDecoration(
                gradient: RadialGradient(
                  center: Alignment(-0.6, -0.7),
                  radius: 1.2,
                  colors: [Color(0xFF3A1A12), Color(0xFF1A0E12), AppColors.bgElevated],
                  stops: [0, 0.45, 1],
                ),
              ),
              child: Padding(
                padding: const EdgeInsets.all(48),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    Image.asset('assets/images/full_logo.png', height: 120),
                    const SizedBox(height: 24),
                    Text(
                      'EVERY CONTAINER. EVERY TRACK.',
                      style: AppTheme.display(fontSize: 46),
                    ),
                    const SizedBox(height: 12),
                    const SizedBox(
                      width: 520,
                      child: Text(
                        'This build plays MKV, AVI and TS straight through, with the embedded '
                        'audio and subtitle tracks a browser never sees.',
                        style: TextStyle(color: AppColors.textSecondary, height: 1.5),
                      ),
                    ),
                    const FilmstripDivider(margin: EdgeInsets.only(top: 28, bottom: 8)),
                    const Row(
                      children: [
                        MetaBadge(label: 'MKV'),
                        SizedBox(width: 6),
                        MetaBadge(label: 'DIRECT PLAY'),
                        SizedBox(width: 6),
                        MetaBadge(label: 'EMBEDDED SUBS', color: AppColors.textSecondary),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
          Container(width: 1, color: AppColors.divider),
          SizedBox(
            width: 440,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 32),
              child: Center(
                child: SingleChildScrollView(child: form),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Form extends StatelessWidget {
  final _Mode mode;
  final TextEditingController nameController;
  final TextEditingController emailController;
  final TextEditingController passwordController;
  final bool submitting;
  final String? error;
  final VoidCallback onSubmit;
  final VoidCallback onToggleMode;

  const _Form({
    required this.mode,
    required this.nameController,
    required this.emailController,
    required this.passwordController,
    required this.submitting,
    required this.error,
    required this.onSubmit,
    required this.onToggleMode,
  });

  @override
  Widget build(BuildContext context) {
    final isSignUp = mode == _Mode.signUp;

    return AutofillGroup(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(isSignUp ? 'Create account' : 'Sign in', style: AppTheme.display(fontSize: 30)),
          const SizedBox(height: 4),
          Text(
            'Campfire v$appVersion · email and password, nothing else',
            style: const TextStyle(color: AppColors.textTertiary, fontSize: 11.5),
          ),
          const SizedBox(height: 22),
          if (isSignUp) ...[
            TextField(
              controller: nameController,
              textCapitalization: TextCapitalization.words,
              textInputAction: TextInputAction.next,
              autofillHints: const [AutofillHints.name],
              style: const TextStyle(color: AppColors.foreground),
              decoration: const InputDecoration(labelText: 'Name (optional)'),
            ),
            const SizedBox(height: 14),
          ],
          TextField(
            controller: emailController,
            keyboardType: TextInputType.emailAddress,
            autocorrect: false,
            textInputAction: TextInputAction.next,
            autofillHints: const [AutofillHints.email],
            style: const TextStyle(color: AppColors.foreground),
            decoration: const InputDecoration(labelText: 'Email'),
          ),
          const SizedBox(height: 14),
          PasswordField(
            controller: passwordController,
            autofillNewPassword: isSignUp,
            helperText: isSignUp ? 'At least 8 characters.' : null,
            onSubmitted: (_) => onSubmit(),
          ),
          if (error != null) ...[
            const SizedBox(height: 14),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.error_outline, color: AppColors.danger, size: 16),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    error!,
                    style: const TextStyle(
                      color: AppColors.danger,
                      fontSize: 12.5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: 22),
          FilledButton(
            onPressed: submitting ? null : onSubmit,
            style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
            child: Text(submitting ? 'Please wait…' : (isSignUp ? 'Create account' : 'Sign in')),
          ),
          const SizedBox(height: 8),
          TextButton(
            onPressed: submitting ? null : onToggleMode,
            child: Text(
              isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up",
              style: const TextStyle(color: AppColors.textSecondary),
            ),
          ),
          const SizedBox(height: 10),
          const Text(
            'On an Android TV, Campfire shows a pairing code instead of this form.',
            textAlign: TextAlign.center,
            style: TextStyle(color: AppColors.textTertiary, fontSize: 11.5, height: 1.4),
          ),
        ],
      ),
    );
  }
}
