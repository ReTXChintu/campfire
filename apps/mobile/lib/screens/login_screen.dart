import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';

enum _Mode { signIn, signUp }

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

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit(AuthService auth) async {
    setState(() => _submitting = true);
    if (_mode == _Mode.signUp) {
      await auth.signUp(
        _emailController.text.trim(),
        _passwordController.text,
        _nameController.text.trim().isEmpty ? null : _nameController.text.trim(),
      );
    } else {
      await auth.signIn(_emailController.text.trim(), _passwordController.text);
    }
    if (mounted) setState(() => _submitting = false);
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthService>();
    final isSignUp = _mode == _Mode.signUp;

    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: RadialGradient(
            center: Alignment(0, -0.4),
            radius: 1.1,
            colors: [Color(0xFF3A1A12), Color(0xFF1A0E12), AppColors.background],
            stops: [0, 0.4, 0.9],
          ),
        ),
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                RichText(
                  text: TextSpan(
                    style: AppTheme.display(fontSize: 56),
                    children: const [
                      TextSpan(text: 'CAMPFIRE'),
                      TextSpan(text: '•', style: TextStyle(color: AppColors.accent)),
                    ],
                  ),
                ),
                const SizedBox(height: 8),
                const Text('Your library, ready to watch.', style: TextStyle(color: AppColors.textSecondary)),
                const SizedBox(height: 32),
                if (isSignUp) ...[
                  TextField(
                    controller: _nameController,
                    textCapitalization: TextCapitalization.words,
                    style: const TextStyle(color: Colors.white),
                    decoration: const InputDecoration(labelText: 'Name (optional)'),
                  ),
                  const SizedBox(height: 16),
                ],
                TextField(
                  controller: _emailController,
                  keyboardType: TextInputType.emailAddress,
                  autocorrect: false,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(labelText: 'Email'),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _passwordController,
                  obscureText: true,
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    labelText: 'Password',
                    helperText: isSignUp ? 'At least 8 characters.' : null,
                  ),
                  onSubmitted: (_) => _submit(auth),
                ),
                if (auth.error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 16),
                    child: Text(auth.error!, style: const TextStyle(color: Colors.redAccent)),
                  ),
                const SizedBox(height: 24),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: _submitting ? null : () => _submit(auth),
                    style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14)),
                    child: Text(
                      _submitting ? 'Please wait…' : (isSignUp ? 'Create account' : 'Sign in'),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                TextButton(
                  onPressed: () => setState(() {
                    _mode = isSignUp ? _Mode.signIn : _Mode.signUp;
                    auth.error = null;
                  }),
                  child: Text(
                    isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up",
                    style: const TextStyle(color: AppColors.textSecondary),
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
