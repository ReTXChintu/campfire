import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../models/catalog.dart';
import '../services/library_store.dart';
import '../theme/app_theme.dart';
import '../utils/media_meta.dart';
import '../widgets/app_shell.dart';
import '../widgets/media_card.dart';
import '../widgets/tv_focusable.dart';
import '../widgets/ui_kit.dart';

enum _Kind { all, series, movies }

enum _Sort { library, titleAsc, titleDesc, yearDesc }

/// The browse grid every rail's "See all" lands on — 2 columns on a phone, up to 6 on a desktop
/// window, with type chips and a sort. Filtering and sorting happen over the already-fetched
/// library ([LibraryStore]); there is no list endpoint that takes filter or sort parameters, and
/// this doesn't pretend there is.
class BrowseScreen extends StatefulWidget {
  /// "series" | "movies" | null — from `/browse?type=…`, which is how the sidebar's Series and
  /// Movies entries and the Home rails' "See all" link in.
  final String? type;

  const BrowseScreen({super.key, this.type});

  @override
  State<BrowseScreen> createState() => _BrowseScreenState();
}

class _BrowseScreenState extends State<BrowseScreen> {
  _Kind? _kindOverride;
  _Sort _sort = _Sort.library;

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
    // A fresh deep-link (sidebar Series → Movies) overrides whatever chip the user last tapped.
    if (oldWidget.type != widget.type) _kindOverride = null;
  }

  List<CatalogListItem> _items(LibraryStore store) {
    final data = store.data;
    if (data == null) return const [];
    final items = switch (_kind) {
      _Kind.series => [...data.folders],
      _Kind.movies => [...data.videos],
      _Kind.all => [...data.folders, ...data.videos],
    };

    int year(CatalogListItem item) {
      final video = item is CatalogVideoItem ? item : null;
      return MediaMeta.parse(item.name, mimeType: video?.mimeType).year ?? 0;
    }

    switch (_sort) {
      case _Sort.library:
        break;
      case _Sort.titleAsc:
        items.sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
      case _Sort.titleDesc:
        items.sort((a, b) => b.name.toLowerCase().compareTo(a.name.toLowerCase()));
      case _Sort.yearDesc:
        // Titles whose name carries no year sink to the bottom rather than being guessed at.
        items.sort((a, b) => year(b).compareTo(year(a)));
    }
    return items;
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<LibraryStore>();
    final width = MediaQuery.sizeOf(context).width;
    final gutter = AppLayout.gutter(width);
    final items = _items(store);
    final title = switch (_kind) {
      _Kind.series => 'Series',
      _Kind.movies => 'Movies',
      _Kind.all => 'Browse',
    };

    return Column(
      children: [
        PaneHeader(
          title: title,
          showBack: !AppLayout.usesSidebar(width),
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
  final _Sort sort;
  final ValueChanged<_Sort> onChanged;

  const _SortButton({required this.sort, required this.onChanged});

  static String _label(_Sort sort) => switch (sort) {
    _Sort.library => 'Library order',
    _Sort.titleAsc => 'Title A–Z',
    _Sort.titleDesc => 'Title Z–A',
    _Sort.yearDesc => 'Year, newest',
  };

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Sort: ${_label(sort)}',
      child: TvFocusable(
        borderRadius: BorderRadius.circular(AppRadius.pill),
        onTap: () async {
          final picked = await showOptionPicker<_Sort>(
            context: context,
            title: 'Sort by',
            selected: sort,
            options: [
              for (final option in _Sort.values)
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
