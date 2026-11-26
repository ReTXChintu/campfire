import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../models/feed.dart';
import '../services/title_service.dart';
import '../theme/app_theme.dart';
import '../widgets/feed/title_cards.dart';
import '../widgets/ui_kit.dart';
import 'home_screen.dart' show feedKinds;

/// One of Home's feed sections as an endless grid (`/section/:id?kind=…`; web SectionPage.tsx).
/// Pages come from TMDb's own lists, which move while they're paged through — so a title can come
/// twice, and is shown once.
class SectionScreen extends StatefulWidget {
  final String sectionId;
  final String kind;

  const SectionScreen({super.key, required this.sectionId, this.kind = 'all'});

  @override
  State<SectionScreen> createState() => _SectionScreenState();
}

class _SectionScreenState extends State<SectionScreen> {
  final _scroll = ScrollController();
  late String _kind = feedKinds.any((k) => k.$1 == widget.kind) ? widget.kind : 'all';
  String? _title;
  final List<TitleItem> _items = [];
  final Set<String> _keys = {};
  int? _next = 1;
  bool _loading = false;
  Object? _error;
  // Bumped on every kind change, so an answer for the kind before is dropped.
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_maybeLoadMore);
    _load();
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final page = _next;
    if (_loading || page == null) return;
    final generation = _generation;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await TitleService.fetchSection(widget.sectionId, kind: _kind, page: page);
      if (!mounted || generation != _generation) return;
      setState(() {
        _title ??= result.title;
        for (final item in result.items) {
          if (_keys.add(item.key)) _items.add(item);
        }
        _next = result.next;
      });
    } catch (e) {
      if (mounted && generation == _generation) setState(() => _error = e);
    } finally {
      if (mounted && generation == _generation) setState(() => _loading = false);
    }
    WidgetsBinding.instance.addPostFrameCallback((_) => _maybeLoadMore());
  }

  void _maybeLoadMore() {
    if (!mounted || !_scroll.hasClients || _loading || _error != null || _next == null) return;
    if (_scroll.position.extentAfter < 900) _load();
  }

  void _setKind(String kind) {
    if (kind == _kind) return;
    setState(() {
      _kind = kind;
      _generation++;
      _items.clear();
      _keys.clear();
      _next = 1;
      _loading = false;
      _error = null;
    });
    if (_scroll.hasClients) _scroll.jumpTo(0);
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final gutter = AppLayout.gutter(width);

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(gutter - 8, 8, gutter, 0),
              child: Row(
                children: [
                  IconButton(
                    icon: const Icon(Icons.arrow_back, color: AppColors.foreground),
                    tooltip: 'Back',
                    onPressed: () => context.canPop() ? context.pop() : context.go('/'),
                  ),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      _title ?? '',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppTheme.display(fontSize: 28),
                    ),
                  ),
                ],
              ),
            ),
            SizedBox(
              height: 60,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: EdgeInsets.symmetric(horizontal: gutter, vertical: 12),
                children: [
                  for (final (value, label) in feedKinds) ...[
                    CampfireChip(label: label, selected: _kind == value, onTap: () => _setKind(value)),
                    const SizedBox(width: 8),
                  ],
                ],
              ),
            ),
            Expanded(child: _body(gutter)),
          ],
        ),
      ),
    );
  }

  Widget _body(double gutter) {
    if (_items.isEmpty && _loading) {
      return Padding(
        padding: EdgeInsets.symmetric(horizontal: gutter),
        child: GridSkeleton(columns: TitleGrid.columnsFor(MediaQuery.sizeOf(context).width - 2 * gutter)),
      );
    }
    if (_items.isEmpty && _error != null) {
      return ListView(children: [ErrorRetry(title: "This section didn't load", error: _error, onRetry: _load)]);
    }
    if (_items.isEmpty) {
      return const EmptyState(
        icon: Icons.movie_filter_outlined,
        title: 'Nothing here',
        body: 'TMDb has nothing in this section for that choice right now.',
      );
    }
    return TitleGrid(
      items: _items,
      controller: _scroll,
      padding: EdgeInsets.fromLTRB(gutter, 4, gutter, 16),
      footer: _error != null
          ? ErrorRetry(title: "The next titles didn't load", error: _error, onRetry: _load)
          : _loading
              ? const Padding(
                  padding: EdgeInsets.all(24),
                  child: Center(child: CircularProgressIndicator(color: AppColors.accent)),
                )
              : const SizedBox(height: 24),
    );
  }
}
