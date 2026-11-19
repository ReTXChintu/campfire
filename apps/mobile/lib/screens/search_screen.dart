import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/catalog.dart';
import '../services/library_store.dart';
import '../theme/app_theme.dart';
import '../utils/media_meta.dart';
import '../widgets/app_shell.dart';
import '../widgets/authed_network_image.dart';
import '../widgets/request_sheet.dart';
import '../widgets/tv_focusable.dart';
import '../widgets/ui_kit.dart';
import '../models/discovery.dart';

/// Search — the single biggest gap in the old app (there was none at all, on any screen).
///
/// **There is no search endpoint on the backend**, so this filters the already-fetched library
/// client-side ([LibraryStore]) rather than inventing an API. That's honest and, for a private
/// library of this size, instant. Recent searches are stored on-device in SharedPreferences —
/// nothing about them is sent anywhere.
class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key});

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

enum _Filter { all, series, movies, inProgress }

class _SearchScreenState extends State<SearchScreen> {
  static const _recentKey = 'campfire_recent_searches';
  static const _maxRecent = 8;

  final _controller = TextEditingController();
  final _focus = FocusNode();
  _Filter _filter = _Filter.all;
  List<String> _recent = const [];

  @override
  void initState() {
    super.initState();
    _loadRecent();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<LibraryStore>().ensureLoaded();
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  Future<void> _loadRecent() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;
    setState(() => _recent = prefs.getStringList(_recentKey) ?? const []);
  }

  Future<void> _remember(String term) async {
    final trimmed = term.trim();
    if (trimmed.length < 2) return;
    final next = [trimmed, ..._recent.where((r) => r.toLowerCase() != trimmed.toLowerCase())]
        .take(_maxRecent)
        .toList();
    setState(() => _recent = next);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(_recentKey, next);
  }

  Future<void> _forget(String term) async {
    final next = _recent.where((r) => r != term).toList();
    setState(() => _recent = next);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(_recentKey, next);
  }

  void _run(String term) {
    _controller.text = term;
    _controller.selection = TextSelection.collapsed(offset: term.length);
    _remember(term);
    setState(() {});
  }

  List<CatalogListItem> _results(LibraryStore store) {
    final query = _controller.text.trim().toLowerCase();
    final progress = store.progressByFileId;
    var items = store.allItems.where((item) {
      switch (_filter) {
        case _Filter.series:
          return item is CatalogFolderItem;
        case _Filter.movies:
          return item is CatalogVideoItem;
        case _Filter.inProgress:
          final p = progress[item.id];
          return p != null && !p.completed && p.positionSeconds > 0;
        case _Filter.all:
          return true;
      }
    }).toList();

    if (query.isEmpty) return items;

    // Title, genre or a lead actor (models/discovery.dart), plus — for a title TMDb doesn't know —
    // the cleaned filename and its parsed year, so "gravel sky" still finds
    // "Gravel.Sky.2020.1080p.mkv" and "2020" still finds it by year.
    items = items.where((item) {
      if (matchItem(item, query) != null) return true;
      final video = item is CatalogVideoItem ? item : null;
      final meta = MediaMeta.parse(item.name, mimeType: video?.mimeType);
      final haystack = '${item.name} ${meta.title} ${meta.line}'.toLowerCase();
      return query.split(RegExp(r'\s+')).every(haystack.contains);
    }).toList();

    // Prefix matches first — with a short library, relevance is mostly "does it start with it".
    items.sort((a, b) {
      final aStarts = a.name.toLowerCase().startsWith(query) ? 0 : 1;
      final bStarts = b.name.toLowerCase().startsWith(query) ? 0 : 1;
      if (aStarts != bStarts) return aStarts - bStarts;
      return a.name.toLowerCase().compareTo(b.name.toLowerCase());
    });
    return items;
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<LibraryStore>();
    final gutter = AppLayout.gutter(MediaQuery.sizeOf(context).width);
    final query = _controller.text.trim();
    final results = store.hasData ? _results(store) : const <CatalogListItem>[];

    return Column(
      children: [
        PaneHeader(
          title: 'Search',
          bottom: Padding(
            padding: EdgeInsets.fromLTRB(gutter, 0, gutter, 12),
            child: _field(),
          ),
        ),
        SizedBox(
          height: 60,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: EdgeInsets.symmetric(horizontal: gutter, vertical: 12),
            children: [
              for (final filter in _Filter.values) ...[
                CampfireChip(
                  label: _label(filter),
                  selected: _filter == filter,
                  onTap: () => setState(() => _filter = filter),
                ),
                const SizedBox(width: 8),
              ],
            ],
          ),
        ),
        Expanded(child: _body(context, store, query, results, gutter)),
      ],
    );
  }

  String _label(_Filter filter) => switch (filter) {
    _Filter.all => 'All',
    _Filter.series => 'Series',
    _Filter.movies => 'Movies',
    _Filter.inProgress => 'Continue watching',
  };

  Widget _field() {
    return Container(
      height: 48,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.pill),
        border: Border.all(color: AppColors.dividerStrong),
      ),
      child: Row(
        children: [
          const Icon(Icons.search, size: 19, color: AppColors.textTertiary),
          const SizedBox(width: 9),
          Expanded(
            child: TextField(
              controller: _controller,
              focusNode: _focus,
              textInputAction: TextInputAction.search,
              style: const TextStyle(color: AppColors.foreground, fontSize: 15),
              decoration: const InputDecoration(
                isDense: true,
                filled: false,
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                hintText: 'Titles, year, quality…',
                hintStyle: TextStyle(color: AppColors.textTertiary),
                contentPadding: EdgeInsets.zero,
              ),
              onChanged: (_) => setState(() {}),
              onSubmitted: _remember,
            ),
          ),
          if (_controller.text.isNotEmpty)
            IconButton(
              tooltip: 'Clear search',
              icon: const Icon(Icons.close, size: 18, color: AppColors.textSecondary),
              onPressed: () => setState(_controller.clear),
            ),
        ],
      ),
    );
  }

  Widget _body(
    BuildContext context,
    LibraryStore store,
    String query,
    List<CatalogListItem> results,
    double gutter,
  ) {
    if (store.loading && !store.hasData) {
      return ListView(
        padding: EdgeInsets.symmetric(horizontal: gutter),
        children: const [
          Shimmer(height: 68, radius: AppRadius.md),
          SizedBox(height: 10),
          Shimmer(height: 68, radius: AppRadius.md),
          SizedBox(height: 10),
          Shimmer(height: 68, radius: AppRadius.md),
        ],
      );
    }
    if (store.error != null && !store.hasData) {
      return ListView(
        children: [
          ErrorRetry(
            title: "Couldn't load the library to search",
            error: store.error,
            onRetry: store.refresh,
          ),
        ],
      );
    }

    if (query.isEmpty && _filter == _Filter.all) {
      if (_recent.isEmpty) {
        return EmptyState(
          icon: Icons.search,
          title: 'Search your library',
          body: 'Everything published is searchable by title, year or quality — '
              'and if it is not here, you can ask for it.',
          actionLabel: 'Request a title',
          onAction: () => _openRequestForm(store),
        );
      }
      return ListView(
        padding: const EdgeInsets.only(bottom: 24),
        children: [
          Padding(
            padding: EdgeInsets.fromLTRB(gutter, 14, gutter, 6),
            child: const Text(
              'RECENT SEARCHES',
              style: TextStyle(
                color: AppColors.textTertiary,
                fontSize: 10.5,
                fontWeight: FontWeight.w700,
                letterSpacing: 1.3,
              ),
            ),
          ),
          for (final term in _recent)
            _RecentRow(
              term: term,
              gutter: gutter,
              onTap: () => _run(term),
              onRemove: () => _forget(term),
            ),
        ],
      );
    }

    if (results.isEmpty) {
      return EmptyState(
        icon: Icons.sentiment_dissatisfied_outlined,
        title: query.isEmpty ? 'Nothing matches that filter' : 'No results for "$query"',
        body: query.isEmpty
            ? 'Try another filter.'
            : "It isn't in the library yet — ask for it and the admin will see the request.",
        actionLabel: query.isEmpty ? null : 'Request "$query"',
        onAction: query.isEmpty ? null : () => _openRequestForm(store, initialTitle: query),
      );
    }

    return ListView.separated(
      padding: EdgeInsets.fromLTRB(gutter, 4, gutter, 24),
      itemCount: results.length,
      separatorBuilder: (context, index) => const SizedBox(height: 4),
      itemBuilder: (context, index) => _ResultRow(
        item: results[index],
        progress: store.progressByFileId[results[index].id],
        // "With Matt Smith" — why an actor's name found this, which otherwise looks like a bug.
        reason: reasonLabel(matchItem(results[index], query)),
      ),
    );
  }

  Future<void> _openRequestForm(LibraryStore store, {String? initialTitle}) async {
    final created = await showRequestSheet(
      context,
      initialTitle: initialTitle,
      libraryItems: store.allItems,
    );
    if (created == null || !mounted) return;
    context.go('/requests');
  }
}

class _RecentRow extends StatelessWidget {
  final String term;
  final double gutter;
  final VoidCallback onTap;
  final VoidCallback onRemove;

  const _RecentRow({
    required this.term,
    required this.gutter,
    required this.onTap,
    required this.onRemove,
  });

  @override
  Widget build(BuildContext context) {
    return TvFocusable(
      borderRadius: BorderRadius.circular(AppRadius.sm),
      onTap: onTap,
      child: Container(
        constraints: const BoxConstraints(minHeight: 48),
        padding: EdgeInsets.symmetric(horizontal: gutter),
        child: Row(
          children: [
            const Icon(Icons.history, size: 17, color: AppColors.textTertiary),
            const SizedBox(width: 12),
            Expanded(
              child: Text(term, style: const TextStyle(color: AppColors.foreground, fontSize: 14)),
            ),
            IconButton(
              tooltip: 'Remove "$term" from recent searches',
              icon: const Icon(Icons.close, size: 16, color: AppColors.textTertiary),
              onPressed: onRemove,
            ),
          ],
        ),
      ),
    );
  }
}

/// A search result row: 16:9 still, title, and the metadata line the file name actually carries.
class _ResultRow extends StatelessWidget {
  final CatalogListItem item;
  final WatchProgress? progress;

  /// Why it matched, when it wasn't the title.
  final String? reason;

  const _ResultRow({required this.item, this.progress, this.reason});

  @override
  Widget build(BuildContext context) {
    final video = item is CatalogVideoItem ? item as CatalogVideoItem : null;
    final meta = MediaMeta.parse(item.name, mimeType: video?.mimeType);
    final isFolder = item is CatalogFolderItem;
    final remaining = progress == null
        ? null
        : remainingLabel(
            progress!.positionSeconds,
            progress!.durationSeconds,
            completed: progress!.completed,
          );
    final subtitle = [
      isFolder ? 'Series' : 'Movie',
      if (item.year != null) '${item.year}' else if (meta.hasAny) meta.line,
      ?remaining,
    ].join(' · ');

    return TvFocusable(
      borderRadius: BorderRadius.circular(AppRadius.sm),
      onTap: () => isFolder ? context.push('/folder/${item.id}') : context.push('/watch/${item.id}'),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(AppRadius.sm),
              child: SizedBox(
                width: 96,
                height: 54,
                child: isFolder
                    ? ((item as CatalogFolderItem).thumbnailFileId == null
                        ? const ColoredBox(
                            color: AppColors.surface,
                            child: Icon(
                              Icons.video_library_outlined,
                              size: 20,
                              color: AppColors.textTertiary,
                            ),
                          )
                        : AuthedNetworkImage(path: '/api/thumbnail-folder/${item.id}'))
                    : AuthedNetworkImage(path: '/api/thumbnail/${item.id}'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    meta.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppColors.foreground,
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text.rich(
                    TextSpan(
                      children: [
                        if (reason != null)
                          TextSpan(text: '$reason · ', style: const TextStyle(color: AppColors.amber)),
                        TextSpan(text: subtitle),
                      ],
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: AppColors.textTertiary, fontSize: 11.5),
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right, size: 18, color: AppColors.textTertiary),
          ],
        ),
      ),
    );
  }
}
