import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../models/catalog.dart';
import '../theme/app_theme.dart';
import 'authed_network_image.dart';

class FolderCard extends StatelessWidget {
  final CatalogFolderItem item;
  const FolderCard({super.key, required this.item});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => context.push('/folder/${item.id}'),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: AspectRatio(
          aspectRatio: 16 / 9,
          child: Stack(
            fit: StackFit.expand,
            children: [
              if (item.thumbnailFileId != null)
                AuthedNetworkImage(path: '/api/thumbnail-folder/${item.id}')
              else
                Container(
                  color: AppColors.surface,
                  alignment: Alignment.center,
                  child: const Icon(Icons.video_library_outlined, color: AppColors.textSecondary, size: 32),
                ),
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
            ],
          ),
        ),
      ),
    );
  }
}
