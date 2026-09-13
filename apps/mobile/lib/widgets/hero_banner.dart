import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../theme/app_theme.dart';
import 'authed_network_image.dart';

class HeroBanner extends StatelessWidget {
  final String title;
  final String? badge;
  final String playHref;
  final String? infoHref;
  // A ready-to-fetch backend path (e.g. "/api/thumbnail/<id>") — null when the hero item is a
  // folder with no thumbnail yet, in which case this falls back to the original gradient-only look.
  final String? thumbnailPath;

  const HeroBanner({
    super.key,
    required this.title,
    this.badge,
    required this.playHref,
    this.infoHref,
    this.thumbnailPath,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 340,
      width: double.infinity,
      color: AppColors.background,
      child: Stack(
        children: [
          if (thumbnailPath != null)
            Positioned.fill(child: AuthedNetworkImage(path: thumbnailPath!, fit: BoxFit.cover)),
          // Darkens the backdrop image enough to keep the title/buttons legible; falls back to the
          // original brand-colored radial gradient when there's no image to darken.
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: thumbnailPath != null
                    ? LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [
                          Colors.black.withValues(alpha: 0.35),
                          Colors.black.withValues(alpha: 0.15),
                          AppColors.background,
                        ],
                        stops: const [0, 0.5, 1],
                      )
                    : const RadialGradient(
                        center: Alignment(0.4, -0.6),
                        radius: 1.2,
                        colors: [Color(0xFF3A1A12), Color(0xFF1A0E12), AppColors.background],
                        stops: [0, 0.4, 0.9],
                      ),
              ),
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            height: 140,
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.bottomCenter,
                  end: Alignment.topCenter,
                  colors: [AppColors.background, AppColors.background.withValues(alpha: 0)],
                ),
              ),
            ),
          ),
          Positioned(
            left: 16,
            right: 16,
            bottom: 24,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                if (badge != null)
                  Container(
                    margin: const EdgeInsets.only(bottom: 12),
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppColors.amber.withValues(alpha: 0.1),
                      border: Border.all(color: AppColors.amber.withValues(alpha: 0.3)),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      badge!.toUpperCase(),
                      style: const TextStyle(color: AppColors.amber, fontSize: 11, letterSpacing: 1),
                    ),
                  ),
                Text(
                  title,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: AppTheme.display(fontSize: 44),
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    ElevatedButton.icon(
                      // Gives the home screen an initial D-pad focus target on Android TV —
                      // without this, the first remote press has nothing to move focus from.
                      autofocus: true,
                      onPressed: () => context.push(playHref),
                      icon: const Icon(Icons.play_arrow, size: 20),
                      label: const Text('Play'),
                    ),
                    if (infoHref != null) ...[
                      const SizedBox(width: 10),
                      OutlinedButton(
                        onPressed: () => context.push(infoHref!),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: Colors.white,
                          backgroundColor: Colors.white.withValues(alpha: 0.1),
                          side: BorderSide(color: Colors.white.withValues(alpha: 0.15)),
                        ),
                        child: const Text('More Info'),
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
