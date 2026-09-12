import 'package:flutter/material.dart';
import '../models/catalog.dart';
import '../services/catalog_service.dart';
import '../theme/app_theme.dart';
import '../widgets/authed_network_image.dart';
import '../widgets/season_dropdown.dart';
import '../widgets/top_bar.dart';
import '../widgets/video_grid.dart';

class FolderScreen extends StatefulWidget {
  final String folderId;

  const FolderScreen({super.key, required this.folderId});

  @override
  State<FolderScreen> createState() => _FolderScreenState();
}

class _FolderScreenState extends State<FolderScreen> {
  String? _season;
  late Future<FolderResponse> _future;

  @override
  void initState() {
    super.initState();
    _future = CatalogService.fetchFolder(widget.folderId);
  }

  void _selectSeason(String seasonId) {
    setState(() {
      _season = seasonId;
      _future = CatalogService.fetchFolder(widget.folderId, season: seasonId);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: const TopBar(showBack: true),
      body: FutureBuilder<FolderResponse>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(
              child: Text('Not found', style: const TextStyle(color: AppColors.textSecondary)),
            );
          }

          final data = snapshot.data!;
          final progressByFileId = {for (final p in data.progress) p.fileId: p};

          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            children: [
              if (data.thumbnailFileId != null)
                ClipRRect(
                  borderRadius: BorderRadius.circular(10),
                  child: AspectRatio(
                    aspectRatio: 16 / 9,
                    child: AuthedNetworkImage(path: '/api/thumbnail-folder/${data.folderId}'),
                  ),
                ),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Text(data.title, style: AppTheme.display(fontSize: 34)),
                  ),
                  if (data.isSeries && data.seasons.length > 1)
                    SeasonDropdown(
                      seasons: data.seasons,
                      selectedId: _season ?? data.selectedSeasonId!,
                      onChanged: _selectSeason,
                    ),
                ],
              ),
              const SizedBox(height: 16),
              if (data.isSeries) ...[
                VideoGrid(items: data.seasonItems, progressByFileId: progressByFileId, autofocusFirstItem: true),
                if (data.specialItems.isNotEmpty) ...[
                  const SizedBox(height: 24),
                  const Text('Specials', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 12),
                  VideoGrid(items: data.specialItems, progressByFileId: progressByFileId),
                ],
              ] else
                VideoGrid(items: data.items, progressByFileId: progressByFileId, autofocusFirstItem: true),
            ],
          );
        },
      ),
    );
  }
}
