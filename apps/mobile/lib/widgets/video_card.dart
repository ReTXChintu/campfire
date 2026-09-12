import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../models/catalog.dart';
import '../theme/app_theme.dart';
import 'authed_network_image.dart';
import 'tv_focusable.dart';

class VideoCard extends StatelessWidget {
  final CatalogVideoItem item;
  final WatchProgress? progress;
  final bool autofocus;

  const VideoCard({super.key, required this.item, this.progress, this.autofocus = false});

  @override
  Widget build(BuildContext context) {
    final percent = (progress != null && progress!.durationSeconds > 0)
        ? (progress!.positionSeconds / progress!.durationSeconds).clamp(0.0, 1.0)
        : 0.0;

    return TvFocusable(
      autofocus: autofocus,
      borderRadius: BorderRadius.circular(8),
      onTap: () => context.push('/watch/${item.id}'),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: Container(
          decoration: BoxDecoration(border: Border.all(color: AppColors.divider)),
          child: AspectRatio(
            aspectRatio: 16 / 9,
            child: Stack(
              fit: StackFit.expand,
              children: [
                AuthedNetworkImage(path: '/api/thumbnail/${item.id}'),
                const DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.bottomCenter,
                      end: Alignment.topCenter,
                      colors: [Colors.black87, Colors.transparent],
                      stops: [0, 0.7],
                    ),
                  ),
                ),
                if (progress?.completed == true)
                  const Positioned(
                    top: 6,
                    right: 6,
                    child: CircleAvatar(
                      radius: 9,
                      backgroundColor: AppColors.live,
                      child: Icon(Icons.check, size: 12, color: Colors.black),
                    ),
                  ),
                Positioned(
                  left: 10,
                  right: 10,
                  bottom: 8,
                  child: Text(
                    item.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w500),
                  ),
                ),
                if (percent > 0)
                  Positioned(
                    left: 0,
                    right: 0,
                    bottom: 0,
                    child: FractionallySizedBox(
                      widthFactor: percent,
                      alignment: Alignment.centerLeft,
                      child: Container(height: 3, color: AppColors.accent),
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
