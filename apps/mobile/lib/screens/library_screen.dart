import 'package:flutter/material.dart';
import '../models/catalog.dart';
import '../services/catalog_service.dart';
import '../theme/app_theme.dart';
import '../widgets/folder_card.dart';
import '../widgets/hero_banner.dart';
import '../widgets/rail.dart';
import '../widgets/top_bar.dart';
import '../widgets/video_card.dart';

class LibraryScreen extends StatefulWidget {
  const LibraryScreen({super.key});

  @override
  State<LibraryScreen> createState() => _LibraryScreenState();
}

class _LibraryScreenState extends State<LibraryScreen> {
  late Future<LibraryResponse> _future;

  @override
  void initState() {
    super.initState();
    _future = CatalogService.fetchLibrary();
  }

  Future<void> _refresh() async {
    final next = CatalogService.fetchLibrary();
    setState(() => _future = next);
    await next;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: const TopBar(),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<LibraryResponse>(
          future: _future,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snapshot.hasError) {
              return _ScrollableMessage('Failed to load your library: ${snapshot.error}');
            }
            final data = snapshot.data!;
            if (data.empty) {
              return const _ScrollableMessage('Your library is empty — curate something in the web admin to get started.');
            }

            return ListView(
              padding: const EdgeInsets.only(bottom: 24),
              children: [
                if (data.hero != null)
                  HeroBanner(
                    title: data.hero!.title,
                    badge: data.hero!.badge,
                    playHref: data.hero!.playHref,
                    infoHref: data.hero!.infoHref,
                  ),
                if (data.continueWatching.isNotEmpty)
                  Rail(
                    title: 'Continue Watching',
                    children: data.continueWatching
                        .map((e) => VideoCard(item: e.item as CatalogVideoItem, progress: e.progress))
                        .toList(),
                  ),
                if (data.folders.isNotEmpty)
                  Rail(
                    title: 'Series',
                    children: data.folders.map((f) => FolderCard(item: f as CatalogFolderItem)).toList(),
                  ),
                if (data.videos.isNotEmpty)
                  Rail(
                    title: 'Movies',
                    children: data.videos.map((v) => VideoCard(item: v as CatalogVideoItem)).toList(),
                  ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _ScrollableMessage extends StatelessWidget {
  final String text;
  const _ScrollableMessage(this.text);

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [Text(text, style: const TextStyle(color: AppColors.textSecondary))],
    );
  }
}
