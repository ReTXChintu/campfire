import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';

class LoginScreen extends StatelessWidget {
  const LoginScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthService>();

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
              if (auth.error != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: Text(auth.error!, style: const TextStyle(color: Colors.redAccent)),
                ),
              ElevatedButton.icon(
                onPressed: () => auth.signIn(),
                icon: const Icon(Icons.g_mobiledata, size: 26),
                label: const Text('Sign in with Google'),
                style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
