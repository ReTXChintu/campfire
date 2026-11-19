import 'dart:async';

import 'package:flutter/material.dart';

import '../models/explore.dart';
import '../models/media_request.dart';
import '../services/explore_service.dart';
import '../services/requests_service.dart';
import '../theme/app_theme.dart';
import '../widgets/explore_detail.dart';
import '../widgets/fisheye_wall.dart';
import '../widgets/tv_focusable.dart';
import '../widgets/ui_kit.dart';

/// Explore — all of TMDb, not just the library, for anyone who doesn't know what to watch: the
/// fisheye wall (widgets/fisheye_wall.dart), filters for films/series, "In Campfire" and the
/// streaming services, a TMDb search, and for each title where it streams in India. Same backend
/// and same look as the web app's Explore page.
class ExploreScreen extends StatefulWidget {
  const ExploreScreen({super.key});

  @override
  State<ExploreScreen> createState() => _ExploreScreenState();
}

const _maxServices = 3;

class _ExploreScreenState extends State<ExploreScreen> {
  final _wallKey = GlobalKey<FisheyeWallState>();
  String _kind = 'all';
  final Set<int> _services = {};
  bool _libOnly = false;
  ExploreWall? _wall;
  Object? _error;
  bool _loading = true;
  bool _wallFailed = false;
  bool _panelOpen = false;
  WallItem? _focused;
  int _request = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final request = ++_request;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final wall = await ExploreApi.fetchWall(kind: _kind, services: _services.toList());
      if (!mounted || request != _request) return;
      setState(() {
        _wall = wall;
        _focused = null;
        _loading = false;
      });
    } catch (e) {
      if (!mounted || request != _request) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  /// "In Campfire" brings the library's titles to the middle, rather than leaving a handful of
  /// them scattered among hundreds (the rest stay, dimmed).
  List<WallItem> get _items {
    final all = _wall?.items ?? const <WallItem>[];
    if (!_libOnly) return all;
    return [...all.where((i) => i.inCampfire), ...all.where((i) => !i.inCampfire)];
  }

  List<WallItem>? _itemsCache;
  List<WallItem>? _itemsFrom;
  bool? _itemsLib;
  List<WallItem> get _stableItems {
    final from = _wall?.items;
    if (_itemsCache == null || !identical(from, _itemsFrom) || _itemsLib != _libOnly) {
      _itemsFrom = from;
      _itemsLib = _libOnly;
      _itemsCache = _items;
    }
    return _itemsCache!;
  }

  Future<void> _open(String tmdbType, String tmdbId) async {
    setState(() => _panelOpen = true);
    await showExploreDetail(context, tmdbType: tmdbType, tmdbId: tmdbId);
    if (mounted) setState(() => _panelOpen = false);
  }

  void _setKind(String kind) {
    if (kind == _kind) return;
    setState(() => _kind = kind);
    _load();
  }

  void _toggleService(int id) {
    setState(() {
      if (!_services.remove(id)) {
        if (_services.length >= _maxServices) return;
        _services.add(id);
      }
    });
    _load();
  }

  Future<void> _search() async {
    final pick = await showModalBottomSheet<TmdbSearchResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: AppColors.bgElevated,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg))),
      builder: (context) => const _SearchSheet(),
    );
    if (pick == null || !mounted) return;
    final onWall = _wallKey.currentState?.glideTo('${pick.tmdbType}-${pick.tmdbId}') ?? false;
    if (!onWall) _open(pick.tmdbType, pick.tmdbId);
  }

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final gutter = AppLayout.gutter(width);
    final wall = _wall;
    final items = _stableItems;

    Widget body;
    if (wall != null && !wall.available) {
      body = const EmptyState(
        icon: Icons.travel_explore,
        title: 'Explore isn\'t set up',
        body: 'It needs a TMDb API key on the server.',
      );
    } else if (_error != null && wall == null) {
      body = Center(
        child: Padding(
          padding: EdgeInsets.all(gutter),
          child: ErrorRetry(title: 'Explore didn\'t load', error: _error, onRetry: _load),
        ),
      );
    } else if (wall == null) {
      body = const Center(child: CircularProgressIndicator(color: AppColors.accent));
    } else if (items.isEmpty) {
      body = const EmptyState(
        icon: Icons.filter_alt_off_outlined,
        title: 'Nothing matches',
        body: 'Try another service.',
      );
    } else if (_wallFailed || wall.imageBase == null) {
      body = _PosterGrid(items: items, imageBase: wall.imageBase ?? 'https://image.tmdb.org/t/p', onOpen: (i) => _open(i.tmdbType, i.tmdbId), gutter: gutter);
    } else {
      body = FisheyeWall(
        key: _wallKey,
        items: items,
        imageBase: wall.imageBase!,
        libOnly: _libOnly,
        panelOpen: _panelOpen,
        onOpen: (item) => _open(item.tmdbType, item.tmdbId),
        onFocusChanged: (item) {
          if (item.key != _focused?.key) setState(() => _focused = item);
        },
        onFail: () => setState(() => _wallFailed = true),
      );
    }

    final showWallChrome = wall != null && items.isNotEmpty && !_wallFailed;
    return Scaffold(
      backgroundColor: const Color(0xFF0B0A09),
      body: Stack(
        children: [
          Positioned.fill(child: body),
          if (_loading && wall != null)
            const Positioned(top: 0, left: 0, right: 0, child: LinearProgressIndicator(minHeight: 2, color: AppColors.accent, backgroundColor: Colors.transparent)),
          // Filters, over a fade so they read on top of the posters.
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: IgnorePointer(
              child: Container(
                height: 120,
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [Color(0xD9000000), Color(0x00000000)],
                  ),
                ),
              ),
            ),
          ),
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.only(top: 10),
                child: _Filters(
                  gutter: gutter,
                  kind: _kind,
                  libOnly: _libOnly,
                  services: _services,
                  available: wall?.services ?? const [],
                  onKind: _setKind,
                  onLib: () => setState(() => _libOnly = !_libOnly),
                  onService: _toggleService,
                  onSearch: _search,
                ),
              ),
            ),
          ),
          if (showWallChrome && _focused != null)
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: _FocusedCard(
                item: _focused!,
                gutter: gutter,
                wide: width >= AppLayout.sidebarBreakpoint,
                onOpen: () => _open(_focused!.tmdbType, _focused!.tmdbId),
                onSurprise: () => _wallKey.currentState?.surprise(),
              ),
            ),
        ],
      ),
    );
  }
}

class _Filters extends StatelessWidget {
  final double gutter;
  final String kind;
  final bool libOnly;
  final Set<int> services;
  final List<ExploreService> available;
  final ValueChanged<String> onKind;
  final VoidCallback onLib;
  final ValueChanged<int> onService;
  final VoidCallback onSearch;

  const _Filters({
    required this.gutter,
    required this.kind,
    required this.libOnly,
    required this.services,
    required this.available,
    required this.onKind,
    required this.onLib,
    required this.onService,
    required this.onSearch,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 44,
      child: Row(
        children: [
          Expanded(
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: EdgeInsets.only(left: gutter, right: 8),
              children: [
                for (final (value, label) in const [('all', 'All'), ('movie', 'Films'), ('tv', 'Series')]) ...[
                  Center(child: CampfireChip(label: label, selected: kind == value, onTap: () => onKind(value))),
                  const SizedBox(width: 8),
                ],
                const _Divider(),
                Center(
                  child: CampfireChip(label: 'In Campfire', icon: Icons.local_fire_department_outlined, selected: libOnly, onTap: onLib),
                ),
                if (available.isNotEmpty) const _Divider(),
                for (final s in available) ...[
                  Center(
                    child: _ServiceChip(
                      service: s,
                      selected: services.contains(s.id),
                      enabled: services.contains(s.id) || services.length < _maxServices,
                      onTap: () => onService(s.id),
                    ),
                  ),
                  const SizedBox(width: 8),
                ],
              ],
            ),
          ),
          Padding(
            padding: EdgeInsets.only(right: gutter),
            child: TvFocusable(
              borderRadius: BorderRadius.circular(AppRadius.pill),
              onTap: onSearch,
              child: Semantics(
                button: true,
                label: 'Search any title',
                excludeSemantics: true,
                child: Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: const Color(0xB3000000),
                    shape: BoxShape.circle,
                    border: Border.all(color: AppColors.dividerStrong),
                  ),
                  child: const Icon(Icons.search, size: 20, color: AppColors.foreground),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Divider extends StatelessWidget {
  const _Divider();

  @override
  Widget build(BuildContext context) => Center(
        child: Container(width: 1, height: 22, margin: const EdgeInsets.only(left: 2, right: 10), color: AppColors.dividerStrong),
      );
}

class _ServiceChip extends StatelessWidget {
  final ExploreService service;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;

  const _ServiceChip({required this.service, required this.selected, required this.enabled, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return TvFocusable(
      borderRadius: BorderRadius.circular(AppRadius.pill),
      onTap: enabled ? onTap : () {},
      child: Tooltip(
        message: enabled ? service.name : 'Up to three at once',
        child: Semantics(
          button: true,
          selected: selected,
          enabled: enabled,
          label: 'Streaming on ${service.name}',
          excludeSemantics: true,
          child: Opacity(
            opacity: enabled ? 1 : 0.4,
            child: Container(
              height: 38,
              padding: const EdgeInsets.all(3),
              decoration: BoxDecoration(
                color: selected ? AppColors.accent : const Color(0xB3000000),
                borderRadius: BorderRadius.circular(AppRadius.pill),
                border: Border.all(color: selected ? AppColors.accent : AppColors.dividerStrong),
              ),
              child: ClipOval(
                child: service.logoUrl == null
                    ? SizedBox(
                        width: 30,
                        height: 30,
                        child: Center(child: Text(service.name.substring(0, 1), style: const TextStyle(color: AppColors.foreground))),
                      )
                    : Image.network(service.logoUrl!, width: 30, height: 30, errorBuilder: (_, _, _) => const SizedBox(width: 30, height: 30)),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The title in the middle of the lens, with what to do about it.
class _FocusedCard extends StatelessWidget {
  final WallItem item;
  final double gutter;
  final bool wide;
  final VoidCallback onOpen;
  final VoidCallback onSurprise;

  const _FocusedCard({required this.item, required this.gutter, required this.wide, required this.onOpen, required this.onSurprise});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.fromLTRB(gutter, 56, gutter, wide ? 22 : 14),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.bottomCenter,
          end: Alignment.topCenter,
          colors: [Color(0xE6000000), Color(0x66000000), Color(0x00000000)],
          stops: [0, 0.55, 1],
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    if (item.inCampfire) ...[
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(color: AppColors.live, borderRadius: BorderRadius.circular(5)),
                        child: const Text('IN CAMPFIRE',
                            style: TextStyle(color: AppColors.background, fontSize: 10, fontWeight: FontWeight.w800, letterSpacing: 0.6)),
                      ),
                      const SizedBox(width: 8),
                    ],
                    Text(item.isSeries ? 'SERIES' : 'FILM',
                        style: const TextStyle(color: AppColors.textTertiary, fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.3)),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  item.title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: AppTheme.display(fontSize: wide ? 48 : 34).copyWith(
                    height: 0.95,
                    shadows: const [Shadow(color: Color(0xB3000000), blurRadius: 18)],
                  ),
                ),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 10,
                  runSpacing: 2,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    if (item.rating != null)
                      Row(mainAxisSize: MainAxisSize.min, children: [
                        const Icon(Icons.star_rounded, size: 15, color: AppColors.amber),
                        const SizedBox(width: 3),
                        Text(item.rating!.toStringAsFixed(1),
                            style: const TextStyle(color: AppColors.foreground, fontSize: 13, fontWeight: FontWeight.w600)),
                      ]),
                    if (item.year != null) Text('${item.year}', style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                    if (item.genres.isNotEmpty)
                      Text(item.genres.join(' · '), style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                  ],
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 10,
                  runSpacing: 8,
                  children: [
                    _CardButton(label: 'Where to watch', primary: true, onTap: onOpen),
                    _CardButton(label: 'Surprise me', icon: Icons.shuffle, onTap: onSurprise),
                  ],
                ),
              ],
            ),
          ),
          if (wide)
            const Padding(
              padding: EdgeInsets.only(left: 16),
              child: Text(
                'Drag to move · Scroll to zoom · Click to open\n← ↑ ↓ → step · Enter open · + − zoom',
                textAlign: TextAlign.right,
                style: TextStyle(color: AppColors.textTertiary, fontSize: 11, height: 1.6),
              ),
            ),
        ],
      ),
    );
  }
}

class _CardButton extends StatelessWidget {
  final String label;
  final IconData? icon;
  final bool primary;
  final VoidCallback onTap;

  const _CardButton({required this.label, this.icon, this.primary = false, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final fg = primary ? AppColors.onAccent : AppColors.foreground;
    return TvFocusable(
      borderRadius: BorderRadius.circular(12),
      onTap: onTap,
      child: Container(
        height: 44,
        padding: const EdgeInsets.symmetric(horizontal: 18),
        decoration: BoxDecoration(
          color: primary ? AppColors.accent : const Color(0x80000000),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: primary ? AppColors.accent : const Color(0x26FFFFFF)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[Icon(icon, size: 17, color: fg), const SizedBox(width: 8)],
            Text(label, style: TextStyle(color: fg, fontSize: 14, fontWeight: FontWeight.w700)),
          ],
        ),
      ),
    );
  }
}

/// Without the shader (an old GPU, or it failed to load): the same titles as a plain grid.
class _PosterGrid extends StatelessWidget {
  final List<WallItem> items;
  final String imageBase;
  final ValueChanged<WallItem> onOpen;
  final double gutter;

  const _PosterGrid({required this.items, required this.imageBase, required this.onOpen, required this.gutter});

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      padding: EdgeInsets.fromLTRB(gutter, 120, gutter, 24),
      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
        maxCrossAxisExtent: 150,
        childAspectRatio: 0.56,
        mainAxisSpacing: 14,
        crossAxisSpacing: 12,
      ),
      itemCount: items.length,
      itemBuilder: (context, i) {
        final item = items[i];
        return TvFocusable(
          borderRadius: BorderRadius.circular(AppRadius.md),
          onTap: () => onOpen(item),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AspectRatio(
                aspectRatio: 2 / 3,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(AppRadius.md),
                  child: Image.network('$imageBase/w185${item.posterPath}',
                      fit: BoxFit.cover, errorBuilder: (_, _, _) => const ColoredBox(color: AppColors.surface)),
                ),
              ),
              const SizedBox(height: 6),
              Text(item.title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: AppColors.foreground, fontSize: 12.5, fontWeight: FontWeight.w600)),
            ],
          ),
        );
      },
    );
  }
}

/// Search all of TMDb; a pick comes back to the screen, which glides there or opens it.
class _SearchSheet extends StatefulWidget {
  const _SearchSheet();

  @override
  State<_SearchSheet> createState() => _SearchSheetState();
}

class _SearchSheetState extends State<_SearchSheet> {
  final _controller = TextEditingController();
  Timer? _debounce;
  List<TmdbSearchResult> _results = const [];
  bool _searching = false;
  String? _message;
  int _seq = 0;

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _onChanged(String text) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () => _run(text));
  }

  Future<void> _run(String text) async {
    final query = text.trim();
    if (query.length < 2) {
      setState(() {
        _results = const [];
        _message = null;
      });
      return;
    }
    final seq = ++_seq;
    setState(() => _searching = true);
    try {
      final res = await RequestsService.searchTmdb(query);
      if (!mounted || seq != _seq) return;
      setState(() {
        _results = res.results;
        _message = !res.available ? 'Search isn\'t set up on this server.' : (res.results.isEmpty ? 'Nothing on TMDb by that name.' : null);
      });
    } catch (_) {
      if (mounted && seq == _seq) setState(() => _message = 'Search isn\'t answering right now.');
    } finally {
      if (mounted && seq == _seq) setState(() => _searching = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * 0.75,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: TextField(
                controller: _controller,
                autofocus: true,
                onChanged: _onChanged,
                textInputAction: TextInputAction.search,
                onSubmitted: _run,
                style: const TextStyle(color: AppColors.foreground),
                decoration: InputDecoration(
                  hintText: 'Search any film or series',
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: _searching
                      ? const Padding(
                          padding: EdgeInsets.all(14),
                          child: SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.accent)),
                        )
                      : null,
                ),
              ),
            ),
            if (_message != null)
              Padding(
                padding: const EdgeInsets.all(16),
                child: Text(_message!, style: const TextStyle(color: AppColors.textSecondary)),
              ),
            Expanded(
              child: ListView.builder(
                itemCount: _results.length,
                itemBuilder: (context, i) {
                  final r = _results[i];
                  return TvFocusable(
                    onTap: () => Navigator.of(context).pop(r),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      child: Row(
                        children: [
                          ClipRRect(
                            borderRadius: BorderRadius.circular(6),
                            child: r.posterUrl == null
                                ? const SizedBox(width: 40, height: 60, child: ColoredBox(color: AppColors.surface))
                                : Image.network(r.posterUrl!, width: 40, height: 60, fit: BoxFit.cover,
                                    errorBuilder: (_, _, _) => const SizedBox(width: 40, height: 60)),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(r.title,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(color: AppColors.foreground, fontSize: 14, fontWeight: FontWeight.w600)),
                                Text([if (r.year != null) '${r.year}', r.kindLabel].join(' · '),
                                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                              ],
                            ),
                          ),
                          if (r.inLibrary != null)
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(color: AppColors.live, borderRadius: BorderRadius.circular(5)),
                              child: const Text('IN CAMPFIRE',
                                  style: TextStyle(color: AppColors.background, fontSize: 10, fontWeight: FontWeight.w800)),
                            ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
