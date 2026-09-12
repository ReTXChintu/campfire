import 'package:flutter/material.dart';
import '../models/catalog.dart';
import '../theme/app_theme.dart';
import 'folder_card.dart';
import 'video_card.dart';

class VideoGrid extends StatelessWidget {
  final List<CatalogListItem> items;
  final Map<String, WatchProgress> progressByFileId;
  // Gives the first tile initial D-pad focus (Android TV) — without something focused when the
  // screen loads, the first remote press has no current focus to move from. Off by default since
  // multiple VideoGrids can appear on one screen (e.g. FolderScreen's season grid + specials).
  final bool autofocusFirstItem;

  const VideoGrid({
    super.key,
    required this.items,
    this.progressByFileId = const {},
    this.autofocusFirstItem = false,
  });

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 24),
        child: Text('This folder is empty.', style: TextStyle(color: AppColors.textSecondary)),
      );
    }

    final width = MediaQuery.sizeOf(context).width;
    final crossAxisCount = width >= 900 ? 5 : (width >= 600 ? 4 : 3);

    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: items.length,
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: crossAxisCount,
        crossAxisSpacing: 10,
        mainAxisSpacing: 14,
        childAspectRatio: 0.95,
      ),
      itemBuilder: (context, index) {
        final item = items[index];
        final autofocus = autofocusFirstItem && index == 0;
        return switch (item) {
          CatalogFolderItem folder => FolderCard(item: folder, autofocus: autofocus),
          CatalogVideoItem video =>
            VideoCard(item: video, progress: progressByFileId[video.id], autofocus: autofocus),
        };
      },
    );
  }
}
