import 'package:flutter/material.dart';
import '../config.dart';
import '../services/media_headers.dart';
import '../theme/app_theme.dart';

/// Drops a cached image so the next build fetches it again. Flutter's image cache keys a network
/// image by its URL alone, so without this a changed picture (new artwork picked in admin) would
/// keep showing the old one until the app restarts.
void evictAuthedImage(String path) {
  PaintingBinding.instance.imageCache.evict(NetworkImage('$apiBaseUrl$path'));
}

/// A thumbnail/poster image behind an auth-gated backend route (see services/media_headers.dart
/// for why this can just use headers directly, unlike the web app's blob-URL workaround).
class AuthedNetworkImage extends StatelessWidget {
  final String path; // e.g. "/api/thumbnail/$fileId"
  final BoxFit fit;
  final Alignment alignment;

  /// Read out in place of the image. Null leaves it decorative, which is right for artwork that
  /// sits behind a title the screen already shows in text.
  final String? semanticLabel;

  /// Shown while the image loads, and when it fails. The defaults are the film-reel placeholder;
  /// a caller passes something else when a failure is an ordinary outcome rather than a fault —
  /// a wordmark, say, which the backend 404s for any title that hasn't got one.
  final Widget? placeholder;
  final Widget? errorWidget;

  const AuthedNetworkImage({
    super.key,
    required this.path,
    this.fit = BoxFit.cover,
    this.alignment = Alignment.center,
    this.semanticLabel,
    this.placeholder,
    this.errorWidget,
  });

  @override
  Widget build(BuildContext context) {
    final loadingView = placeholder ?? const _Placeholder(loading: true);
    final errorView = errorWidget ?? placeholder ?? const _Placeholder(loading: false);
    return FutureBuilder<Map<String, String>>(
      future: authHeaders(),
      builder: (context, snapshot) {
        if (!snapshot.hasData) return loadingView;
        return Image.network(
          '$apiBaseUrl$path',
          headers: snapshot.data,
          fit: fit,
          alignment: alignment,
          semanticLabel: semanticLabel,
          loadingBuilder: (context, child, progress) => progress == null ? child : loadingView,
          errorBuilder: (context, error, stackTrace) => errorView,
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
