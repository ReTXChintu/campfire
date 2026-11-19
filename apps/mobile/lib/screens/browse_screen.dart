import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../models/catalog.dart';
import '../models/discovery.dart';
import '../services/library_store.dart';
import '../theme/app_theme.dart';
import '../utils/media_meta.dart';
import '../widgets/app_shell.dart';
import '../widgets/media_card.dart';
import '../widgets/tv_focusable.dart';
import '../widgets/ui_kit.dart';

enum _Kind { all, series, movies }

/// Discover — the whole library as one grid, 2 columns on a phone and up to 6 on a desktop window,
/// with All/Series/Movies chips, a row of genre chips and a sort. It's a navigation destination of its own on every
/// platform (bottom nav on a phone, the sidebar on desktop/TV); a Home rail's "See all" lands here
/// with its chip preselected. Filtering and sorting happen over the already-fetched
/// library ([LibraryStore]); there is no list endpoint that takes filter or sort parameters, and
/// this doesn't pretend there is.
class BrowseScreen extends StatefulWidget {
  /// "series" | "movies" | null — from `/discover?type=…`, which is how the Home rails' "See all"
  /// links preselect a chip.
  final String? type;

  /// A genre from `/discover?genre=…` — how a genre row's "See all" on Home preselects its chip.
  final String? genre;

  const BrowseScreen({super.key, this.type, this.genre});

  @override
  State<BrowseScreen> createState() => _BrowseScreenState();
}

class _BrowseScreenState extends State<BrowseScreen> {
  _Kind? _kindOverride;
  SortKey _sort = SortKey.library;

  /// Null until a chip is tapped; until then the route's `?genre=` decides.
  String? _genreOverride;
  bool _genreTouched = false;

  String? get _genre => _genreTouched ? _genreOverride : widget.genre;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<LibraryStore>().ensureLoaded();
    });
  }

  _Kind get _kind =>
      _kindOverride ??
      switch (widget.type) {
        'series' => _Kind.series,
        'movies' => _Kind.movies,
        _ => _Kind.all,
      };

  @override
  void didUpdateWidget(BrowseScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    // A fresh deep-link (Home's Series "See all", then its Movies one) overrides whatever chip the
    // user last tapped.
    if (oldWidget.type != widget.type) _kindOverride = null;
    if (oldWidget.genre != widget.genre) _genreTouched = false;
  }

  List<CatalogListItem> _source(LibraryStore store) {
    final data = store.data;
    if (data == null) return const [];
    return switch (_kind) {
      _Kind.series => [...data.folders],
      _Kind.movies => [...data.videos],
      _Kind.all => [...data.folders, ...data.videos],
    };
  }

  List<CatalogListItem> _items(LibraryStore store) {
    final genre = _genre;
    final items = _source(store).where((item) => genre == null || item.genres.contains(genre)).toList();
    // TMDb's year when the title is matched, else whatever year its filename carries; titles with
    // neither sink to the bottom rather than being guessed at.
    int? year(CatalogListItem item) {
      if (item.year != null) return item.year;
      final video = item is CatalogVideoItem ? item : null;
      return MediaMeta.parse(item.name, mimeType: video?.mimeType).year;
    }

    return sortItems(items, _sort, yearOf: year);
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<LibraryStore>();
    final width = MediaQuery.sizeOf(context).width;
    final gutter = AppLayout.gutter(width);
    final items = _items(store);
    final genres = allGenres(_source(store));
    return Column(
      children: [
        PaneHeader(
          title: 'Discover',
          actions: [
            if (store.hasData)
              Text(
                '${items.length} ${items.length == 1 ? "title" : "titles"}',
                style: const TextStyle(color: AppColors.textTertiary, fontSize: 12),
              ),
            const SizedBox(width: 8),
            _SortButton(sort: _sort, onChanged: (value) => setState(() => _sort = value)),
          ],
        ),
        SizedBox(
          height: 60,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: EdgeInsets.symmetric(horizontal: gutter, vertical: 12),
            children: [
              for (final kind in _Kind.values) ...[
                CampfireChip(
                  label: switch (kind) {
                    _Kind.all => 'All',
                    _Kind.series => 'Series',
                    _Kind.movies => 'Movies',
                  },
                  selected: _kind == kind,
                  onTap: () => setState(() => _kindOverride = kind),
                ),
                const SizedBox(width: 8),
              ],
            ],
          ),
        ),
        if (genres.isNotEmpty)
          SizedBox(
            height: 46,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: EdgeInsets.fromLTRB(gutter, 0, gutter, 10),
              children: [
                for (final g in genres) ...[
                  CampfireChip(
                    label: g,
                    selected: _genre == g,
                    onTap: () => setState(() {
                      _genreTouched = true;
                      _genreOverride = _genre == g ? null : g;
                    }),
                  ),
                  const SizedBox(width: 8),
                ],
              ],
            ),
          ),
        Expanded(child: _body(context, store, items, gutter, width)),
      ],
    );
  }

  Widget _body(
    BuildContext context,
    LibraryStore store,
    List<CatalogListItem> items,
    double gutter,
    double width,
  ) {
    if (store.loading && !store.hasData) {
      return SingleChildScrollView(
        padding: EdgeInsets.symmetric(horizontal: gutter),
        child: GridSkeleton(columns: MediaGrid.columnsFor(width - gutter * 2)),
      );
    }
    if (store.error != null && !store.hasData) {
      return ListView(
        children: [
          ErrorRetry(
            title: "Couldn't load the library",
            error: store.error,
            onRetry: store.refresh,
          ),
        ],
      );
    }
    if (items.isEmpty && _genre != null) {
      return EmptyState(
        icon: Icons.filter_alt_off_outlined,
        title: 'Nothing in $_genre here',
        body: 'Try All, or another genre.',
        actionLabel: 'Clear genre',
        onAction: () => setState(() {
          _genreTouched = true;
          _genreOverride = null;
        }),
      );
    }
    if (items.isEmpty) {
      return EmptyState(
        icon: Icons.grid_view_outlined,
        title: 'Nothing here yet',
        body: _kind == _Kind.series
            ? 'No series have been published yet.'
            : 'No movies have been published yet.',
        actionLabel: 'Request a title',
        onAction: () => context.go('/requests'),
      );
    }

    return RefreshIndicator(
      onRefresh: store.refresh,
      color: AppColors.accent,
      backgroundColor: AppColors.surface,
      child: MediaGrid(
        items: items,
        progressByFileId: store.progressByFileId,
        autofocusFirstItem: true,
        shrinkWrap: false,
        physics: const AlwaysScrollableScrollPhysics(),
        padding: EdgeInsets.fromLTRB(gutter, 4, gutter, 28),
      ),
    );
  }
}

class _SortButton extends StatelessWidget {
  final SortKey sort;
  final ValueChanged<SortKey> onChanged;

  const _SortButton({required this.sort, required this.onChanged});

  static String _label(SortKey sort) => switch (sort) {
    SortKey.library => 'Library order',
    SortKey.az => 'Title A–Z',
    SortKey.za => 'Title Z–A',
    SortKey.rating => 'Highest rated',
    SortKey.newest => 'Year, newest',
  };

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Sort: ${_label(sort)}',
      child: TvFocusable(
        borderRadius: BorderRadius.circular(AppRadius.pill),
        onTap: () async {
          final picked = await showOptionPicker<SortKey>(
            context: context,
            title: 'Sort by',
            selected: sort,
            options: [
              for (final option in SortKey.values)
                PickerOption(value: option, label: _label(option)),
            ],
          );
          if (picked != null) onChanged(picked);
        },
        child: Container(
          height: 40,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          decoration: BoxDecoration(
            color: AppColors.bgElevated,
            borderRadius: BorderRadius.circular(AppRadius.pill),
            border: Border.all(color: AppColors.dividerStrong),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.sort, size: 15, color: AppColors.textSecondary),
              const SizedBox(width: 6),
              Text(
                _label(sort),
                style: const TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
