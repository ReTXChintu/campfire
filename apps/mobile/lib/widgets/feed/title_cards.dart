import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../models/feed.dart';
import '../../services/opinion_store.dart';
import '../../theme/app_theme.dart';
import '../explore_detail.dart';
import '../tv_focusable.dart';
import '../ui_kit.dart';

/// Home's feed cards: any title on TMDb, in the library or not (web
/// apps/frontend/src/components/feed/TitleCard.tsx). Every one opens the details panel.

/// Opens a title in the details panel; with [play], on the sources to play it from.
Future<void> openTitle(BuildContext context, TitleItem item, {bool play = false}) =>
    showExploreDetail(context, tmdbType: item.tmdbType, tmdbId: item.tmdbId, play: play);

String _label(TitleItem item, [int? rank]) => [
      if (rank != null) 'Number $rank: ',
      item.title,
      if (item.year != null) ' (${item.year})',
      ', ${item.kindLabel}',
      if (item.inLibrary != null) ', in your library',
    ].join();

/// A TMDb image, or the surface colour while it loads or when there's none.
class TmdbImage extends StatelessWidget {
  final String? url;
  final BoxFit fit;
  final Alignment alignment;

  const TmdbImage({super.key, required this.url, this.fit = BoxFit.cover, this.alignment = Alignment.center});

  @override
  Widget build(BuildContext context) {
    const blank = ColoredBox(color: AppColors.surface, child: SizedBox.expand());
    final url = this.url;
    if (url == null) return blank;
    return Image.network(
      url,
      fit: fit,
      alignment: alignment,
      width: double.infinity,
      height: double.infinity,
      gaplessPlayback: true,
      errorBuilder: (_, _, _) => blank,
      frameBuilder: (context, child, frame, sync) => frame == null && !sync ? blank : child,
    );
  }
}

/// "IN LIBRARY" and a watched tick, top-left of the artwork.
class TitleBadges extends StatelessWidget {
  final TitleItem item;

  const TitleBadges({super.key, required this.item});

  @override
  Widget build(BuildContext context) {
    final watched = context.select<OpinionStore, bool>((s) => s.opinionOf(item.tmdbType, item.tmdbId)?.watched ?? false);
    if (item.inLibrary == null && !watched) return const SizedBox.shrink();
    return Positioned(
      left: 8,
      top: 8,
      right: 8,
      child: Row(
        children: [
          if (item.inLibrary != null)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
              decoration: BoxDecoration(color: AppColors.live, borderRadius: BorderRadius.circular(6)),
              child: const Text(
                'IN LIBRARY',
                style: TextStyle(color: AppColors.background, fontSize: 9.5, fontWeight: FontWeight.w800, letterSpacing: 0.6),
              ),
            ),
          const Spacer(),
          if (watched)
            Container(
              padding: const EdgeInsets.all(3),
              decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.7), shape: BoxShape.circle),
              child: const Icon(Icons.check, size: 13, color: AppColors.live, semanticLabel: 'Watched'),
            ),
        ],
      ),
    );
  }
}

/// ★ 7.4 in white, the rest in [color].
Widget ratingLine(TitleItem item, List<String> facts, {Color color = AppColors.textTertiary, double fontSize = 11.5}) {
  return Text.rich(
    TextSpan(
      children: [
        if (item.rating != null) ...[
          WidgetSpan(
            alignment: PlaceholderAlignment.middle,
            child: Icon(Icons.star_rounded, size: fontSize + 2, color: AppColors.amber),
          ),
          TextSpan(
            text: ' ${item.rating!.toStringAsFixed(1)}${facts.isEmpty ? '' : '  '}',
            style: const TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w700),
          ),
        ],
        TextSpan(text: facts.join(' · ')),
      ],
    ),
    maxLines: 1,
    overflow: TextOverflow.ellipsis,
    style: TextStyle(color: color, fontSize: fontSize),
  );
}

BoxDecoration get _frame => BoxDecoration(
      borderRadius: BorderRadius.circular(AppRadius.md),
      border: Border.all(color: AppColors.divider),
    );

/// A poster, its title and year under it.
class PosterTitleCard extends StatelessWidget {
  final TitleItem item;
  final bool autofocus;

  /// Below the meta line, when For you says why.
  final bool showReason;

  /// Everything under the poster, so a rail can size itself.
  static const textBlockHeight = 44.0;
  static const reasonHeight = 32.0;

  const PosterTitleCard({super.key, required this.item, this.autofocus = false, this.showReason = false});

  @override
  Widget build(BuildContext context) {
    return TvFocusable(
      autofocus: autofocus,
      borderRadius: BorderRadius.circular(AppRadius.md),
      onTap: () => openTitle(context, item),
      child: Semantics(
        button: true,
        label: _label(item),
        excludeSemantics: true,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Container(
                foregroundDecoration: _frame,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(AppRadius.md),
                  child: Stack(
                    fit: StackFit.expand,
                    children: [TmdbImage(url: item.posterUrl), TitleBadges(item: item)],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 7),
            Text(
              item.title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: AppColors.foreground, fontSize: 13.5, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 2),
            ratingLine(item, [if (item.year != null) '${item.year}', item.kindLabel]),
            if (showReason)
              SizedBox(
                height: reasonHeight,
                child: Padding(
                  padding: const EdgeInsets.only(top: 3),
                  child: Text(
                    item.reason ?? '',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: AppColors.amber, fontSize: 11.5, height: 1.25),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// A still, with the title on it.
class WideTitleCard extends StatelessWidget {
  final TitleItem item;
  final bool autofocus;

  const WideTitleCard({super.key, required this.item, this.autofocus = false});

  @override
  Widget build(BuildContext context) {
    return TvFocusable(
      autofocus: autofocus,
      borderRadius: BorderRadius.circular(AppRadius.md),
      onTap: () => openTitle(context, item),
      child: Semantics(
        button: true,
        label: _label(item),
        excludeSemantics: true,
        child: Container(
          foregroundDecoration: _frame,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(AppRadius.md),
            child: Stack(
              fit: StackFit.expand,
              children: [
                TmdbImage(url: item.smallBackdropUrl ?? item.posterUrl),
                const DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.bottomCenter,
                      end: Alignment.topCenter,
                      colors: [Color(0xE6000000), Color(0x26000000), Colors.transparent],
                      stops: [0, 0.55, 1],
                    ),
                  ),
                ),
                TitleBadges(item: item),
                Positioned(
                  left: 12,
                  right: 12,
                  bottom: 10,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(item.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppTheme.display(fontSize: 22)),
                      const SizedBox(height: 3),
                      ratingLine(
                        item,
                        [if (item.year != null) '${item.year}', item.kindLabel, ?item.genres.firstOrNull],
                        color: AppColors.textSecondary,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A poster beside its place in the list.
class RankTitleCard extends StatelessWidget {
  final TitleItem item;
  final int rank;
  final bool autofocus;

  /// How much of the card's width the number takes; the poster has the rest.
  static const numberShare = 0.38;

  const RankTitleCard({super.key, required this.item, required this.rank, this.autofocus = false});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final size = constraints.maxHeight * 0.78;
        final number = AppTheme.display(fontSize: size).copyWith(height: 0.8, letterSpacing: -size * 0.06);
        return TvFocusable(
          autofocus: autofocus,
          borderRadius: BorderRadius.circular(AppRadius.md),
          onTap: () => openTitle(context, item),
          child: Semantics(
            button: true,
            label: _label(item, rank),
            excludeSemantics: true,
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                // Outlined, in the background colour: it reads as a cut-out behind the poster.
                Positioned(
                  left: 0,
                  bottom: -size * 0.04,
                  child: Stack(
                    children: [
                      Text('$rank', style: number.copyWith(color: AppColors.background)),
                      Text(
                        '$rank',
                        style: number.copyWith(
                          foreground: Paint()
                            ..style = PaintingStyle.stroke
                            ..strokeWidth = 3
                            ..color = const Color(0xFF6F665C),
                        ),
                      ),
                    ],
                  ),
                ),
                Positioned(
                  left: constraints.maxWidth * numberShare,
                  right: 0,
                  top: 0,
                  bottom: 0,
                  child: Container(
                    foregroundDecoration: _frame,
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(AppRadius.md),
                      child: Stack(
                        fit: StackFit.expand,
                        children: [TmdbImage(url: item.posterUrl), TitleBadges(item: item)],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

/// A row of title cards under a heading.
class TitleRail extends StatelessWidget {
  final String title;
  final String? eyebrow;
  final List<TitleItem> items;
  final SectionLook look;
  final VoidCallback? onSeeAll;
  final bool showReasons;
  final bool autofocusFirstItem;

  const TitleRail({
    super.key,
    required this.title,
    required this.items,
    this.eyebrow,
    this.look = SectionLook.poster,
    this.onSeeAll,
    this.showReasons = false,
    this.autofocusFirstItem = false,
  });

  factory TitleRail.section(FeedSection section, {VoidCallback? onSeeAll, bool autofocusFirstItem = false}) => TitleRail(
        title: section.title,
        items: section.items,
        look: section.look,
        // A top ten is all there is of it.
        onSeeAll: section.look == SectionLook.rank ? null : onSeeAll,
        autofocusFirstItem: autofocusFirstItem,
      );

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();
    final width = MediaQuery.sizeOf(context).width;
    final wide = AppLayout.usesSidebar(width);
    final gutter = AppLayout.gutter(width);
    final (cardWidth, height) = switch (look) {
      SectionLook.poster => () {
          final w = wide ? 168.0 : 132.0;
          return (
            w,
            w * 1.5 + PosterTitleCard.textBlockHeight + (showReasons ? PosterTitleCard.reasonHeight : 0),
          );
        }(),
      SectionLook.wide => () {
          final w = wide ? 340.0 : 260.0;
          return (w, w * 9 / 16);
        }(),
      SectionLook.rank => () {
          final w = wide ? 250.0 : 196.0;
          return (w, w * (1 - RankTitleCard.numberShare) * 1.5);
        }(),
    };

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(title: title, onSeeAll: onSeeAll, padding: EdgeInsets.fromLTRB(gutter, 20, gutter, eyebrow == null ? 10 : 2)),
        if (eyebrow != null)
          Padding(
            padding: EdgeInsets.fromLTRB(gutter, 0, gutter, 10),
            child: Text(eyebrow!, style: const TextStyle(color: AppColors.textTertiary, fontSize: 12)),
          ),
        SizedBox(
          // Room for the focus ring to grow without the row cutting it off.
          height: height + 12,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: EdgeInsets.fromLTRB(gutter, 6, gutter, 6),
            itemCount: items.length,
            separatorBuilder: (_, _) => SizedBox(width: look == SectionLook.rank ? 4 : 12),
            itemBuilder: (context, i) {
              final item = items[i];
              final autofocus = autofocusFirstItem && i == 0;
              return SizedBox(
                width: cardWidth,
                child: switch (look) {
                  SectionLook.poster => PosterTitleCard(item: item, autofocus: autofocus, showReason: showReasons),
                  SectionLook.wide => WideTitleCard(item: item, autofocus: autofocus),
                  SectionLook.rank => RankTitleCard(item: item, rank: i + 1, autofocus: autofocus),
                },
              );
            },
          ),
        ),
      ],
    );
  }
}

/// Poster cards in as many columns as fit — a section opened on its own.
class TitleGrid extends StatelessWidget {
  final List<TitleItem> items;
  final EdgeInsets padding;
  final ScrollController? controller;
  final Widget? footer;

  const TitleGrid({super.key, required this.items, required this.padding, this.controller, this.footer});

  static int columnsFor(double width) => (width / 170).floor().clamp(2, 10);

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = columnsFor(constraints.maxWidth - padding.horizontal);
        const spacing = 12.0;
        final itemWidth = (constraints.maxWidth - padding.horizontal - spacing * (columns - 1)) / columns;
        final cellHeight = itemWidth * 1.5 + PosterTitleCard.textBlockHeight;
        return CustomScrollView(
          controller: controller,
          slivers: [
            SliverPadding(
              padding: padding,
              sliver: SliverGrid(
                gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: columns,
                  crossAxisSpacing: spacing,
                  mainAxisSpacing: 18,
                  childAspectRatio: itemWidth / cellHeight,
                ),
                delegate: SliverChildBuilderDelegate(
                  (context, i) => PosterTitleCard(item: items[i], autofocus: i == 0),
                  childCount: items.length,
                ),
              ),
            ),
            if (footer != null) SliverToBoxAdapter(child: footer),
          ],
        );
      },
    );
  }
}
