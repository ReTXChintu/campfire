import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/catalog.dart';
import '../models/media_request.dart';
import '../services/library_store.dart';
import '../services/requests_service.dart';
import '../theme/app_theme.dart';
import '../utils/media_meta.dart';
import '../widgets/app_shell.dart';
import '../widgets/authed_network_image.dart';
import '../widgets/explore_detail.dart';
import '../widgets/request_sheet.dart';
import '../widgets/tv_focusable.dart';
import '../widgets/ui_kit.dart';
import '../models/discovery.dart';

/// Search — the library first, then all of TMDb.
///
/// The library part filters the already-fetched library client-side ([LibraryStore]), which for a
/// private library of this size is instant. Below it come TMDb's matches (the requests form's
/// title search, `GET /api/requests/tmdb-search`), each opening the details panel, so a title the
/// library hasn't got can still be played from a source or asked for. Recent searches are stored
/// on-device in SharedPreferences — nothing about them is sent anywhere.
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

  // TMDb's answer for [_tmdbQuery]; asked a moment after typing stops.
  Timer? _tmdbDebounce;
  String _tmdbQuery = '';
  List<TmdbSearchResult> _tmdbResults = const [];
  bool _tmdbLoading = false;
  bool _tmdbFailed = false;

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
    _tmdbDebounce?.cancel();
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
    _askTmdbSoon();
    setState(() {});
  }

  void _askTmdbSoon() {
    _tmdbDebounce?.cancel();
    final query = _controller.text.trim();
    if (query.length < 2) {
      setState(() {
        _tmdbQuery = '';
        _tmdbResults = const [];
        _tmdbLoading = false;
        _tmdbFailed = false;
      });
      return;
    }
    if (query == _tmdbQuery) return;
    setState(() => _tmdbLoading = true);
    _tmdbDebounce = Timer(const Duration(milliseconds: 350), () => _askTmdb(query));
  }

  Future<void> _askTmdb(String query) async {
    _tmdbQuery = query;
    try {
      final answer = await RequestsService.searchTmdb(query);
      if (!mounted || _controller.text.trim() != query) return;
      setState(() {
        // Without a TMDb key on the server there's nothing to show; the library part stands alone.
        _tmdbResults = answer.available ? answer.results : const [];
        _tmdbFailed = false;
        _tmdbLoading = false;
      });
    } catch (_) {
      if (!mounted || _controller.text.trim() != query) return;
      setState(() {
        _tmdbResults = const [];
        _tmdbFailed = true;
        _tmdbLoading = false;
      });
    }
  }

  /// TMDb's matches the chips leave in. "Continue watching" is the library's alone.
  List<TmdbSearchResult> get _tmdbShown => switch (_filter) {
    _Filter.all => _tmdbResults,
    _Filter.series => _tmdbResults.where((r) => r.isSeries).toList(),
    _Filter.movies => _tmdbResults.where((r) => !r.isSeries).toList(),
    _Filter.inProgress => const [],
  };

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
              onChanged: (_) {
                _askTmdbSoon();
                setState(() {});
              },
              onSubmitted: _remember,
            ),
          ),
          if (_controller.text.isNotEmpty)
            IconButton(
              tooltip: 'Clear search',
              icon: const Icon(Icons.close, size: 18, color: AppColors.textSecondary),
              onPressed: () {
                _controller.clear();
                _askTmdbSoon();
              },
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

    final tmdb = query.length >= 2 ? _tmdbShown : const <TmdbSearchResult>[];
    final asking = query.length >= 2 && _tmdbLoading && _filter != _Filter.inProgress;
    if (results.isEmpty && tmdb.isEmpty && !asking) {
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

    return ListView(
      padding: EdgeInsets.fromLTRB(gutter, 4, gutter, 24),
      children: [
        for (final item in results)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: _ResultRow(
              item: item,
              progress: store.progressByFileId[item.id],
              // "With Matt Smith" — why an actor's name found this, which otherwise looks like a bug.
              reason: reasonLabel(matchItem(item, query)),
            ),
          ),
        if (tmdb.isNotEmpty || asking || (_tmdbFailed && query.length >= 2)) ...[
          const Padding(
            padding: EdgeInsets.fromLTRB(0, 18, 0, 6),
            child: Text(
              'ON TMDB',
              style: TextStyle(
                color: AppColors.textTertiary,
                fontSize: 10.5,
                fontWeight: FontWeight.w700,
                letterSpacing: 1.3,
              ),
            ),
          ),
          if (asking && tmdb.isEmpty) ...const [
            Shimmer(height: 66, radius: AppRadius.sm),
            SizedBox(height: 8),
            Shimmer(height: 66, radius: AppRadius.sm),
          ],
          if (_tmdbFailed && !asking)
            const Text("TMDb isn't answering right now.", style: TextStyle(color: AppColors.textTertiary, fontSize: 13)),
          for (final result in tmdb) _TmdbRow(result: result),
        ],
      ],
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

/// One of TMDb's matches: its poster, title and year. Opens the details panel, which plays it from
/// a source or asks for it.
class _TmdbRow extends StatelessWidget {
  final TmdbSearchResult result;

  const _TmdbRow({required this.result});

  @override
  Widget build(BuildContext context) {
    final poster = result.posterUrl;
    return TvFocusable(
      borderRadius: BorderRadius.circular(AppRadius.sm),
      onTap: () => showExploreDetail(context, tmdbType: result.tmdbType, tmdbId: result.tmdbId),
      child: Semantics(
        button: true,
        label: [
          result.title,
          if (result.year != null) '${result.year}',
          result.kindLabel,
          if (result.inLibrary != null) 'in your library',
        ].join(', '),
        excludeSemantics: true,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(6),
                child: SizedBox(
                  width: 44,
                  height: 66,
                  child: poster == null
                      ? const ColoredBox(color: AppColors.surface)
                      : Image.network(
                          poster,
                          fit: BoxFit.cover,
                          errorBuilder: (_, _, _) => const ColoredBox(color: AppColors.surface),
                        ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      result.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: AppColors.foreground, fontSize: 14, fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      [if (result.year != null) '${result.year}', result.kindLabel].join(' · '),
                      style: const TextStyle(color: AppColors.textTertiary, fontSize: 11.5),
                    ),
                  ],
                ),
              ),
              if (result.inLibrary != null)
                Container(
                  margin: const EdgeInsets.only(left: 8),
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                  decoration: BoxDecoration(color: AppColors.live, borderRadius: BorderRadius.circular(6)),
                  child: const Text(
                    'IN LIBRARY',
                    style: TextStyle(color: AppColors.background, fontSize: 9.5, fontWeight: FontWeight.w800, letterSpacing: 0.6),
                  ),
                ),
              const Icon(Icons.chevron_right, size: 18, color: AppColors.textTertiary),
            ],
          ),
        ),
      ),
    );
  }
}
