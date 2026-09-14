import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../config.dart';
import '../services/api_client.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';

/// Shown instead of login_screen.dart on Android TV (see app_router.dart) — no on-screen-keyboard
/// password entry, just a short code (typed on a phone/browser) or a QR code (scanned). See
/// apps/backend/src/routes/auth.ts's /pair/* routes and apps/frontend/src/routes/LinkDevicePage.tsx.
class TvPairingLoginScreen extends StatefulWidget {
  const TvPairingLoginScreen({super.key});

  @override
  State<TvPairingLoginScreen> createState() => _TvPairingLoginScreenState();
}

class _TvPairingLoginScreenState extends State<TvPairingLoginScreen> {
  String? _code;
  String? _error;
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    _start();
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  Future<void> _start() async {
    try {
      final data = await ApiClient.post('/auth/pair/start') as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        _code = data['code'] as String;
        _error = null;
      });
      _pollTimer = Timer.periodic(const Duration(seconds: 3), (_) => _poll());
    } catch (_) {
      if (mounted) setState(() => _error = "Couldn't start pairing. Check your connection.");
    }
  }

  Future<void> _poll() async {
    final code = _code;
    if (code == null) return;
    try {
      final data = await ApiClient.get('/auth/pair/poll/$code') as Map<String, dynamic>;
      if (data['status'] == 'claimed') {
        _pollTimer?.cancel();
        final token = data['token'] as String;
        if (!mounted) return;
        await context.read<AuthService>().signInWithToken(token);
      }
    } catch (_) {
      // Most likely the code expired (a 404 from the backend) — restart the whole flow with a
      // fresh code rather than polling a dead one forever.
      _pollTimer?.cancel();
      if (mounted) setState(() => _code = null);
      _start();
    }
  }

  @override
  Widget build(BuildContext context) {
    final code = _code;
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Center(
          child: code == null ? _buildLoading() : _buildCode(code),
        ),
      ),
    );
  }

  Widget _buildLoading() {
    if (_error != null) {
      return Text(_error!, style: const TextStyle(color: AppColors.danger, fontSize: 20));
    }
    return const CircularProgressIndicator(color: Colors.white70);
  }

  Widget _buildCode(String code) {
    final claimUrl = '$webBaseUrl/link?code=$code';
    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
          child: QrImageView(data: claimUrl, size: 220),
        ),
        const SizedBox(width: 48),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Sign in to Campfire', style: AppTheme.display(fontSize: 32)),
            const SizedBox(height: 12),
            const Text('Scan the QR code, or go to', style: TextStyle(color: AppColors.textSecondary, fontSize: 20)),
            Text(
              '$webBaseUrl/link',
              style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 24),
            const Text('and enter this code:', style: TextStyle(color: AppColors.textSecondary, fontSize: 20)),
            const SizedBox(height: 8),
            Text(
              code,
              style: const TextStyle(
                color: AppColors.amber,
                fontSize: 56,
                fontWeight: FontWeight.w800,
                letterSpacing: 8,
              ),
            ),
          ],
        ),
      ],
    );
  }
}
