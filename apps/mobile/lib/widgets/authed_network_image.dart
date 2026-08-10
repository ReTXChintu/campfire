import 'package:flutter/material.dart';
import '../config.dart';
import '../services/media_headers.dart';
import '../theme/app_theme.dart';

/// A thumbnail/poster image behind an auth-gated backend route (see services/media_headers.dart
/// for why this can just use headers directly, unlike the web app's blob-URL workaround).
class AuthedNetworkImage extends StatelessWidget {
  final String path; // e.g. "/api/thumbnail/$fileId"
  final BoxFit fit;

  const AuthedNetworkImage({super.key, required this.path, this.fit = BoxFit.cover});

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Map<String, String>>(
      future: authHeaders(),
      builder: (context, snapshot) {
        if (!snapshot.hasData) return const _Placeholder(loading: true);
        return Image.network(
          '$apiBaseUrl$path',
          headers: snapshot.data,
          fit: fit,
          loadingBuilder: (context, child, progress) =>
              progress == null ? child : const _Placeholder(loading: true),
          errorBuilder: (context, error, stackTrace) => const _Placeholder(loading: false),
        );
      },
    );
  }
}

class _Placeholder extends StatelessWidget {
  final bool loading;
  const _Placeholder({required this.loading});

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.surface,
      alignment: Alignment.center,
      child: loading
          ? const SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.textTertiary),
            )
          : const Text('🎬', style: TextStyle(fontSize: 28)),
    );
  }
}
