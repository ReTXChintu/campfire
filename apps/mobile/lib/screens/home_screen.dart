import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../models/catalog.dart';
import '../models/discovery.dart';
import '../models/feed.dart';
import '../services/library_store.dart';
import '../services/opinion_store.dart';
import '../services/title_service.dart';
import '../theme/app_theme.dart';
import '../widgets/app_shell.dart';
import '../widgets/feed/feed_hero.dart';
import '../widgets/feed/for_you_rails.dart';
import '../widgets/feed/title_cards.dart';
import '../widgets/join_party_action.dart';
import '../widgets/media_card.dart';
import '../widgets/request_sheet.dart';
import '../widgets/spotlight_carousel.dart';
import '../widgets/ui_kit.dart';
import '../widgets/update_banner.dart';

/// Kinds the feed can be narrowed to, as `GET /api/feed?kind=` names them.
const feedKinds = [('all', 'All'), ('movie', 'Films'), ('tv', 'Series')];

/// Shortcuts into the feed's sections (same list as the web's HomePage.tsx). TMDb has no such
/// genre for series where `films` is set.
const _shortcuts = [
  (id: 'hot', label: 'New and hot', films: false),
  (id: 'hindi', label: 'Hindi', films: false),
  (id: 'south', label: 'South Indian', films: false),
  (id: 'action', label: 'Action', films: false),
  (id: 'comedy', label: 'Comedy', films: false),
  (id: 'thriller', label: 'Thriller', films: true),
  (id: 'crime', label: 'Crime', films: false),
  (id: 'romance', label: 'Romance', films: true),
  (id: 'horror', label: 'Horror', films: true),
  (id: 'scifi', label: 'Sci-fi and fantasy', films: false),
  (id: 'korean', label: 'Korean', films: false),
  (id: 'anime', label: 'Anime', films: false),
  (id: 'family', label: 'Family', films: false),
  (id: 'documentary', label: 'Documentary', films: false),
  (id: 'acclaimed', label: 'Acclaimed', films: false),
  (id: 'gems', label: 'Hidden gems', films: false),
];

/// Where a section opens on its own.
String sectionRoute(String id, String kind) => kind == 'all' ? '/section/$id' : '/section/$id?kind=$kind';

/// How many of the library's titles its row shows before "See all" takes over.
const _railLimit = 18;

/// The library's own row comes after this many of the feed's.
const _libraryAfter = 2;

/// One kind's feed, as far as it has been paged in.
class _Feed {
  final List<FeedPage> pages = [];
  bool loading = false;
  Object? error;
  Object? nextError;

  bool? get available => pages.firstOrNull?.available;
  int? get next => pages.isEmpty ? 0 : pages.last.next;
  List<TitleItem> get hero => pages.firstOrNull?.hero ?? const [];
  List<FeedSection> get sections => withoutRepeats([for (final p in pages) ...p.sections]);
}

/// Home: all of TMDb as a feed — made once a day server-side — with what the viewer was watching,
/// For you, and what the library can play among it (web apps/frontend/src/routes/HomePage.tsx).
/// Without TMDb on the server, or when the feed can't be had at all, it's the library alone, as it
/// always was.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _scroll = ScrollController();
  final Map<String, _Feed> _feeds = {};
  String _kind = 'all';

  _Feed get _feed => _feeds.putIfAbsent(_kind, _Feed.new);

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_maybeLoadMore);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      context.read<LibraryStore>().ensureLoaded();
      context.read<OpinionStore>().ensureLoaded();
    });
    _load(_kind);
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  /// The next page of [kind]'s feed; its first when nothing is loaded yet.
  Future<void> _load(String kind) async {
    final feed = _feeds.putIfAbsent(kind, _Feed.new);
    final page = feed.next;
    if (feed.loading || page == null) return;
    setState(() {
      feed.loading = true;
      feed.nextError = null;
      if (feed.pages.isEmpty) feed.error = null;
    });
    try {
      final result = await TitleService.fetchFeed(kind: kind, page: page);
      feed.pages.add(result);
    } catch (e) {
      if (feed.pages.isEmpty) {
        feed.error = e;
      } else {
        feed.nextError = e;
      }
    }
    if (!mounted) return;
    setState(() => feed.loading = false);
    // A short first page may not fill the screen, so nothing would scroll to ask for more.
    WidgetsBinding.instance.addPostFrameCallback((_) => _maybeLoadMore());
  }

  void _maybeLoadMore() {
    final feed = _feed;
    if (!mounted || !_scroll.hasClients || feed.loading || feed.nextError != null) return;
    if (feed.pages.isEmpty || feed.available != true || feed.next == null) return;
    if (_scroll.position.extentAfter < 900) _load(_kind);
  }

  void _setKind(String kind) {
    if (kind == _kind) return;
    setState(() => _kind = kind);
    if (_feed.pages.isEmpty) _load(kind);
  }

  Future<void> _refresh(LibraryStore store) async {
    _feeds.clear();
    final opinions = context.read<OpinionStore>();
    await Future.wait([store.refresh(), _load(_kind), opinions.refresh()]);
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
            onRefresh: () => _refresh(store),
            color: AppColors.accent,
            backgroundColor: AppColors.surface,
            child: _body(context, store),
          ),
        ),
      ],
    );
  }

  Widget _body(BuildContext context, LibraryStore store) {
    final feed = _feed;
    // No TMDb on this server, or it isn't answering: the library as it is.
    if (feed.available == false || (feed.error != null && feed.pages.isEmpty)) {
      return _LibraryHome(
        store: store,
        feedError: feed.error,
        onRetryFeed: () => _load(_kind),
      );
    }
    return _feedBody(context, store, feed);
  }

  Widget _feedBody(BuildContext context, LibraryStore store, _Feed feed) {
    final data = store.data;
    final gutter = AppLayout.gutter(MediaQuery.sizeOf(context).width);
    final sections = feed.sections;
    final added = _kind == 'all' && data != null
        ? data.spotlight.where((s) => s.isRequest).take(2).toList()
        : const <SpotlightSlide>[];
    final continueItems = data?.continueWatching.map((e) => e.item).toList() ?? const <CatalogListItem>[];
    final continueProgress = {for (final e in data?.continueWatching ?? const <ContinueWatchingEntry>[]) e.progress.fileId: e.progress};

    final mine = data == null
        ? const <CatalogListItem>[]
        : switch (_kind) {
            'movie' => data.videos,
            'tv' => data.folders,
            _ => [...data.folders, ...data.videos],
          };
    final library = mine.isEmpty
        ? null
        : _LibraryRow(
            items: sortItems(mine, SortKey.newest).take(_railLimit).toList(),
            count: mine.length,
            progressByFileId: store.progressByFileId,
            onSeeAll: () => context.go(switch (_kind) {
              'movie' => '/discover?type=movies',
              'tv' => '/discover?type=series',
              _ => '/discover',
            }),
          );
    final done = feed.pages.isNotEmpty && feed.next == null && !feed.loading;

    return ListView(
      controller: _scroll,
      padding: const EdgeInsets.only(bottom: 28),
      children: [
        const UpdateBanner(),
        if (feed.hero.isNotEmpty)
          FeedHero(key: ValueKey('hero-$_kind'), hero: feed.hero, added: added)
        else
          Shimmer(height: FeedHero.heightFor(MediaQuery.sizeOf(context)), radius: 0),
        _Chips(kind: _kind, onKind: _setKind, gutter: gutter),
        if (continueItems.isNotEmpty)
          MediaRail(title: 'Continue Watching', items: continueItems, progressByFileId: continueProgress),
        if (_kind == 'all' && data != null && !data.empty)
          ForYouRails(items: store.allItems, progressByFileId: store.progressByFileId),
        for (final (i, section) in sections.indexed) ...[
          if (i == _libraryAfter) ?library,
          TitleRail.section(section, onSeeAll: () => context.push(sectionRoute(section.id, _kind))),
        ],
        // Fewer sections than that: the library's row still has a place.
        if (sections.length <= _libraryAfter && done) ?library,
        if (feed.loading) ...[const RailSkeleton(), const RailSkeleton()],
        if (feed.nextError != null)
          ErrorRetry(title: "The next sections didn't load", error: feed.nextError, onRetry: () => _load(_kind)),
        if (done) _Missing(store: store),
        Padding(
          padding: EdgeInsets.fromLTRB(gutter, 24, gutter, 0),
          child: const Text(
            'Titles and artwork from TMDB; streaming availability from JustWatch. This product uses the '
            'TMDB API but is not endorsed or certified by TMDB.',
            style: TextStyle(color: AppColors.textTertiary, fontSize: 11),
          ),
        ),
      ],
    );
  }
}

/// All / Films / Series, then the shortcuts into sections.
class _Chips extends StatelessWidget {
  final String kind;
  final ValueChanged<String> onKind;
  final double gutter;

  const _Chips({required this.kind, required this.onKind, required this.gutter});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 60,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: EdgeInsets.symmetric(horizontal: gutter, vertical: 12),
        children: [
          for (final (value, label) in feedKinds) ...[
            CampfireChip(label: label, selected: kind == value, onTap: () => onKind(value)),
            const SizedBox(width: 8),
          ],
          Container(width: 1, margin: const EdgeInsets.symmetric(horizontal: 6, vertical: 6), color: AppColors.dividerStrong),
          const SizedBox(width: 6),
          for (final s in _shortcuts)
            if (!(s.films && kind == 'tv')) ...[
              CampfireChip(label: s.label, selected: false, onTap: () => context.push(sectionRoute(s.id, kind))),
              const SizedBox(width: 8),
            ],
        ],
      ),
    );
  }
}

/// "In your library": the newest of what it has, of the kind picked.
class _LibraryRow extends StatelessWidget {
  final List<CatalogListItem> items;
  final int count;
  final Map<String, WatchProgress> progressByFileId;
  final VoidCallback onSeeAll;

  const _LibraryRow({required this.items, required this.count, required this.progressByFileId, required this.onSeeAll});

  @override
  Widget build(BuildContext context) {
    return MediaRail(
      title: 'In your library · $count',
      items: items,
      progressByFileId: progressByFileId,
      onSeeAll: onSeeAll,
    );
  }
}

/// The way to ask for what Home doesn't have.
class _Missing extends StatelessWidget {
  final LibraryStore store;

  const _Missing({required this.store});

  Future<void> _request(BuildContext context) async {
    final created = await showRequestSheet(context, libraryItems: store.allItems);
    if (created != null && context.mounted) context.go('/requests');
  }

  @override
  Widget build(BuildContext context) {
    final gutter = AppLayout.gutter(MediaQuery.sizeOf(context).width);
    return Container(
      margin: EdgeInsets.fromLTRB(gutter, 24, gutter, 0),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.divider),
      ),
      child: Wrap(
        spacing: 16,
        runSpacing: 14,
        alignment: WrapAlignment.spaceBetween,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          ConstrainedBox(
            constraints: BoxConstraints(maxWidth: math.max(240, MediaQuery.sizeOf(context).width - 2 * gutter - 360)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('Missing something?', style: AppTheme.display(fontSize: 20)),
                const SizedBox(height: 4),
                const Text(
                  'Ask for a film or a series and follow it from New through Added on the requests board.',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 13.5),
                ),
              ],
            ),
          ),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              OutlinedButton(onPressed: () => context.go('/requests'), child: const Text('Open requests')),
              FilledButton(onPressed: () => _request(context), child: const Text('Request a title')),
            ],
          ),
        ],
      ),
    );
  }
}

/// Home from the library alone: the spotlight carousel, Continue Watching, For you, and a rail
/// per section, each with a "See all" into the browse grid.
class _LibraryHome extends StatelessWidget {
  final LibraryStore store;

  /// Why the feed isn't here, when it failed rather than not being set up.
  final Object? feedError;
  final VoidCallback onRetryFeed;

  const _LibraryHome({required this.store, this.feedError, required this.onRetryFeed});

  @override
  Widget build(BuildContext context) {
    final problem = feedError == null
        ? null
        : ErrorRetry(title: "The feed didn't load", error: feedError, onRetry: onRetryFeed);

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
          ?problem,
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
        ?problem,
        if (continueItems.isNotEmpty)
          MediaRail(
            title: 'Continue Watching',
            items: continueItems,
            progressByFileId: progress,
            autofocusFirstItem: true,
          ),
        // Only the library's picks: without the feed there's nowhere to open the others.
        ForYouRails(items: store.allItems, progressByFileId: store.progressByFileId, withExplore: false),
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
        // A row per well-stocked genre, series and films together, best rated first.
        for (final shelf in genreShelves([...data.folders, ...data.videos])) ...[
          const FilmstripDivider(),
          MediaRail(
            title: shelf.genre,
            items: shelf.items,
            progressByFileId: store.progressByFileId,
            onSeeAll: () => context.go('/discover?genre=${Uri.encodeQueryComponent(shelf.genre)}'),
          ),
        ],
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
