import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../models/admin_catalog.dart';
import '../../theme/app_theme.dart';

/// Mirrors apps/frontend/src/components/admin/CatalogChildrenList.tsx — a flat list of a folder's
/// (or the overview's) child folders and videos, each tappable to drill in, with a status badge.
class CatalogChildrenList extends StatelessWidget {
  final List<CatalogFolder> folders;
  final List<CatalogVideo> videos;

  const CatalogChildrenList({super.key, required this.folders, required this.videos});

  @override
  Widget build(BuildContext context) {
    if (folders.isEmpty && videos.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 16),
        child: Text('No items found here yet — try Scan Drive.', style: TextStyle(color: AppColors.textSecondary)),
      );
    }

    return Column(
      children: [
        ...folders.map(
          (folder) => _Row(
            icon: Icons.folder,
            iconColor: AppColors.amber,
            label: folder.title ?? folder.driveName,
            status: folder.status,
            onTap: () => context.push('/admin/folder/${folder.id}'),
          ),
        ),
        ...videos.map(
          (video) => _Row(
            icon: Icons.movie_outlined,
            iconColor: AppColors.textSecondary,
            label: video.title ?? video.driveName,
            status: video.status,
            onTap: () => context.push('/admin/video/${video.id}'),
          ),
        ),
      ],
    );
  }
}

class _Row extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String label;
  final String status;
  final VoidCallback onTap;

  const _Row({
    required this.icon,
    required this.iconColor,
    required this.label,
    required this.status,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Row(
          children: [
            Icon(icon, size: 18, color: iconColor),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: AppColors.foreground, fontSize: 14),
              ),
            ),
            _StatusBadge(status: status),
          ],
        ),
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  final String status;
  const _StatusBadge({required this.status});

  @override
  Widget build(BuildContext context) {
    final Color color;
    final String label;
    switch (status) {
      case 'published':
        color = AppColors.live;
        label = 'Published';
        break;
      case 'curated':
        color = AppColors.accent;
        label = 'Curated';
        break;
      default:
        color = AppColors.amber;
        label = 'Needs curation';
    }
    return Text(label, style: TextStyle(color: color, fontSize: 12));
  }
}
