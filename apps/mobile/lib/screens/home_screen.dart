import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../services/library_store.dart';
import '../theme/app_theme.dart';
import '../widgets/app_shell.dart';
import '../widgets/join_party_action.dart';
import '../widgets/media_card.dart';
import '../widgets/spotlight_carousel.dart';
import '../widgets/ui_kit.dart';
import '../widgets/update_banner.dart';

/// Home — the spotlight carousel, Continue Watching, and a rail per section, each with a "See
/// all" into the browse grid. Replaces `LibraryScreen`'s single endless rail scroll with
/// something that has an exit into a real, filterable list.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<LibraryStore>().ensureLoaded();
    });
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<LibraryStore>();
    final width = MediaQuery.sizeOf(context).width;
    final wide = AppLayout.usesSidebar(width);

    return Column(
      children: [
        PaneHeader(
          title: 'CAMPFIRE',
          actions: [
            if (!wide)
              IconButton(
                icon: const Icon(Icons.search, color: AppColors.foreground),
                tooltip: 'Search',
                onPressed: () => context.go('/search'),
              ),
            const JoinPartyButton(),
          ],
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: store.refresh,
            color: AppColors.accent,
            backgroundColor: AppColors.surface,
            child: _body(context, store),
          ),
        ),
      ],
    );
  }

  Widget _body(BuildContext context, LibraryStore store) {
    if (store.loading && !store.hasData) return const _HomeSkeleton();

    if (store.error != null && !store.hasData) {
      return ListView(
        children: [
          ErrorRetry(
            title: "Couldn't load your library",
            error: store.error,
            onRetry: store.refresh,
          ),
        ],
      );
    }

    final data = store.data;
    if (data == null) return const _HomeSkeleton();

    if (data.empty) {
      return ListView(
        children: [
          EmptyState(
            icon: Icons.local_fire_department_outlined,
            title: 'Nothing published yet',
            body: 'Once something is curated and published it shows up here. '
                'In the meantime you can ask for a title and the admin will see it.',
            actionLabel: 'Request a title',
            onAction: () => context.go('/requests'),
          ),
        ],
      );
    }

    final continueItems = data.continueWatching.map((e) => e.item).toList();
    final progress = {for (final e in data.continueWatching) e.progress.fileId: e.progress};

    return ListView(
      padding: const EdgeInsets.only(bottom: 28),
      children: [
        const UpdateBanner(),
        // `spotlight` supersedes the single `hero` the backend still sends for older installed
        // builds — see the API contract, and models/catalog.dart.
        if (data.spotlight.isNotEmpty) SpotlightCarousel(slides: data.spotlight),
        if (continueItems.isNotEmpty)
          MediaRail(
            title: 'Continue Watching',
            items: continueItems,
            progressByFileId: progress,
            autofocusFirstItem: true,
          ),
        if (data.folders.isNotEmpty)
          MediaRail(
            title: 'Series',
            items: data.folders,
            onSeeAll: () => context.go('/discover?type=series'),
            autofocusFirstItem: continueItems.isEmpty,
          ),
        if (data.folders.isNotEmpty && data.videos.isNotEmpty) const FilmstripDivider(),
        if (data.videos.isNotEmpty)
          MediaRail(
            title: 'Movies',
            items: data.videos,
            progressByFileId: store.progressByFileId,
            onSeeAll: () => context.go('/discover?type=movies'),
            autofocusFirstItem: continueItems.isEmpty && data.folders.isEmpty,
          ),
      ],
    );
  }
}

/// Skeleton at the real geometry of the screen it stands in for: a spotlight-sized block, then
/// two rails of card skeletons.
class _HomeSkeleton extends StatelessWidget {
  const _HomeSkeleton();

  @override
  Widget build(BuildContext context) {
    final gutter = AppLayout.gutter(MediaQuery.sizeOf(context).width);
    return ListView(
      physics: const NeverScrollableScrollPhysics(),
      children: [
        Padding(
          padding: EdgeInsets.fromLTRB(gutter, 16, gutter, 0),
          child: const Shimmer(height: 320, radius: AppRadius.lg),
        ),
        const RailSkeleton(),
        const RailSkeleton(),
      ],
    );
  }
}
