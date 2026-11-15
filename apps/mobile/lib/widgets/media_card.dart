import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../models/catalog.dart';
import '../theme/app_theme.dart';
import '../utils/media_meta.dart';
import 'authed_network_image.dart';
import 'tv_focusable.dart';
import 'ui_kit.dart';
import 'title_meta_views.dart';

/// The redesigned card: still, title, a metadata line, a quality/container badge and a progress
/// bar — the anatomy from the approved prototypes, minus the fields this backend has no data for.
///
/// What is *not* here and why: there are no 2:3 poster images anywhere in Campfire. The only
/// artwork the API serves is `GET /api/thumbnail/:id` / `/api/thumbnail-folder/:id`, a frame grab
/// from the video itself, so every card is a 16:9 still rather than the prototype's portrait
/// poster. Runtime, genre and rating have no backend field at all and are simply absent; year and
/// resolution are parsed out of the file name when it carries them (see [MediaMeta]) and omitted
/// when it doesn't.
class MediaCard extends StatelessWidget {
  final CatalogListItem item;
  final WatchProgress? progress;
  final bool autofocus;

  /// Height of everything below the still (gap + title + meta line). The grid uses this to pick
  /// a cell aspect ratio that leaves the still a true 16:9, so cards never overflow their cell.
  static const textBlockHeight = 46.0;

  const MediaCard({super.key, required this.item, this.progress, this.autofocus = false});

  bool get _isFolder => item is CatalogFolderItem;

  @override
  Widget build(BuildContext context) {
    final video = item is CatalogVideoItem ? item as CatalogVideoItem : null;
    final meta = MediaMeta.parse(item.name, mimeType: video?.mimeType);
    final percent = progress?.fraction ?? 0.0;
    final remaining = progress == null
        ? null
        : remainingLabel(
            progress!.positionSeconds,
            progress!.durationSeconds,
            completed: progress!.completed,
          );

    return TvFocusable(
      autofocus: autofocus,
      borderRadius: BorderRadius.circular(AppRadius.md),
      onTap: () => _isFolder ? context.push('/folder/${item.id}') : context.push('/watch/${item.id}'),
      child: Semantics(
        button: true,
        label: [meta.title, if (meta.hasAny) meta.line, ?remaining].join(', '),
        excludeSemantics: true,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(AppRadius.md),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    border: Border.all(color: AppColors.divider),
                    borderRadius: BorderRadius.circular(AppRadius.md),
                  ),
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      _Still(item: item),
                      // The scrim only has to carry the badges and the progress bar now that the
                      // title sits below the card instead of on top of the art.
                      const DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.bottomCenter,
                            end: Alignment.topCenter,
                            colors: [Colors.black54, Colors.transparent],
                            stops: [0, 0.55],
                          ),
                        ),
                      ),
                      if (_isFolder)
                        const Positioned(
                          left: 8,
                          top: 8,
                          child: MetaBadge(label: 'SERIES', color: AppColors.foreground),
                        ),
                      if (meta.quality != null || meta.container != null)
                        Positioned(
                          right: 8,
                          top: 8,
                          child: Row(
                            children: [
                              if (meta.quality != null) MetaBadge(label: meta.quality!),
                              if (meta.quality != null && meta.container != null)
                                const SizedBox(width: 4),
                              if (meta.container != null)
                                MetaBadge(label: meta.container!, color: AppColors.textSecondary),
                            ],
                          ),
                        ),
                      if (progress?.completed == true)
                        const Positioned(
                          right: 8,
                          bottom: 8,
                          child: CircleAvatar(
                            radius: 9,
                            backgroundColor: AppColors.live,
                            child: Icon(Icons.check, size: 12, color: AppColors.onAccent),
                          ),
                        ),
                      if (remaining != null)
                        Positioned(
                          left: 8,
                          bottom: 10,
                          child: Text(
                            remaining,
                            style: const TextStyle(
                              color: AppColors.foreground,
                              fontSize: 10.5,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      if (percent > 0)
                        Positioned(
                          left: 0,
                          right: 0,
                          bottom: 0,
                          child: Container(
                            height: 4,
                            color: Colors.white24,
                            child: FractionallySizedBox(
                              widthFactor: percent,
                              alignment: Alignment.centerLeft,
                              child: Container(color: progress?.completed == true ? AppColors.live : AppColors.accent),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              meta.title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppColors.foreground,
                fontSize: 13.5,
                fontWeight: FontWeight.w600,
                height: 1.25,
              ),
            ),
            const SizedBox(height: 2),
            SizedBox(
              height: 15,
              child: Row(
                children: [
                  if (item.rating != null) ...[
                    RatingChip(rating: item.rating, fontSize: 11),
                    const SizedBox(width: 6),
                  ],
                  Expanded(
                    child: Text(
                      // TMDb's year first when the title is matched; the name's own parsed facts
                      // (quality, container) otherwise, exactly as before.
                      [if (item.year != null) '${item.year}', if (meta.hasAny) meta.line].join(' · '),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: AppColors.textTertiary, fontSize: 11.5),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Still extends StatelessWidget {
  final CatalogListItem item;
  const _Still({required this.item});

  @override
  Widget build(BuildContext context) {
    if (item is CatalogFolderItem) {
      final folder = item as CatalogFolderItem;
      if (folder.thumbnailFileId == null) {
        return Container(
          color: AppColors.surface,
          alignment: Alignment.center,
          child: const Icon(Icons.video_library_outlined, color: AppColors.textTertiary, size: 30),
        );
      }
      return AuthedNetworkImage(path: '/api/thumbnail-folder/${item.id}');
    }
    return AuthedNetworkImage(path: '/api/thumbnail/${item.id}');
  }
}

/// A responsive grid of [MediaCard]s: 2 columns on a phone, dense on desktop/TV. Picks the cell
/// aspect ratio from the measured column width so the still stays a true 16:9 and the text block
/// always fits (see [MediaCard.textBlockHeight]).
class MediaGrid extends StatelessWidget {
  final List<CatalogListItem> items;
  final Map<String, WatchProgress> progressByFileId;
  final bool autofocusFirstItem;
  final EdgeInsetsGeometry padding;
  final bool shrinkWrap;
  final ScrollPhysics? physics;

  const MediaGrid({
    super.key,
    required this.items,
    this.progressByFileId = const {},
    this.autofocusFirstItem = false,
    this.padding = EdgeInsets.zero,
    this.shrinkWrap = true,
    this.physics = const NeverScrollableScrollPhysics(),
  });

  static int columnsFor(double width) {
    if (width >= 1500) return 6;
    if (width >= 1200) return 5;
    if (width >= 900) return 4;
    if (width >= 620) return 3;
    return 2;
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final resolved = padding.resolve(Directionality.of(context));
        final available = constraints.maxWidth - resolved.horizontal;
        final columns = columnsFor(constraints.maxWidth);
        const spacing = 12.0;
        final itemWidth = (available - spacing * (columns - 1)) / columns;
        final cellHeight = itemWidth * 9 / 16 + MediaCard.textBlockHeight;

        return GridView.builder(
          padding: padding,
          shrinkWrap: shrinkWrap,
          physics: physics,
          itemCount: items.length,
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: columns,
            crossAxisSpacing: spacing,
            mainAxisSpacing: 18,
            childAspectRatio: itemWidth / cellHeight,
          ),
          itemBuilder: (context, index) {
            final item = items[index];
            return MediaCard(
              item: item,
              progress: progressByFileId[item.id],
              autofocus: autofocusFirstItem && index == 0,
            );
          },
        );
      },
    );
  }
}

/// A horizontally scrolling rail of [MediaCard]s with a section header and an optional "See all".
class MediaRail extends StatelessWidget {
  final String title;
  final List<CatalogListItem> items;
  final Map<String, WatchProgress> progressByFileId;
  final VoidCallback? onSeeAll;
  final bool autofocusFirstItem;

  const MediaRail({
    super.key,
    required this.title,
    required this.items,
    this.progressByFileId = const {},
    this.onSeeAll,
    this.autofocusFirstItem = false,
  });

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= AppLayout.sidebarBreakpoint;
    final cardWidth = wide ? 212.0 : 180.0;
    final railHeight = cardWidth * 9 / 16 + MediaCard.textBlockHeight;
    final gutter = AppLayout.gutter(MediaQuery.sizeOf(context).width);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(
          title: title,
          onSeeAll: onSeeAll,
          padding: EdgeInsets.fromLTRB(gutter, 20, gutter, 10),
        ),
        SizedBox(
          height: railHeight,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: EdgeInsets.symmetric(horizontal: gutter),
            itemCount: items.length,
            separatorBuilder: (context, index) => const SizedBox(width: 12),
            itemBuilder: (context, index) => SizedBox(
              width: cardWidth,
              child: MediaCard(
                item: items[index],
                progress: progressByFileId[items[index].id],
                autofocus: autofocusFirstItem && index == 0,
              ),
            ),
          ),
        ),
      ],
    );
  }
}
