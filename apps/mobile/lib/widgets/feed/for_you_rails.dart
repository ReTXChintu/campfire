import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../models/catalog.dart';
import '../../models/feed.dart';
import '../../services/opinion_store.dart';
import '../../theme/app_theme.dart';
import '../media_card.dart';
import '../ui_kit.dart';
import 'title_cards.dart';

/// What to watch next, from what the viewer has liked and watched: the library's titles, then —
/// with [withExplore] — ones on TMDb that aren't in it (web ForYouRails.tsx). Nothing until
/// there's something to go on.
class ForYouRails extends StatefulWidget {
  /// The library's cards, which the picks are looked up in by kind and id.
  final List<CatalogListItem> items;
  final Map<String, WatchProgress> progressByFileId;
  final bool withExplore;

  const ForYouRails({super.key, required this.items, this.progressByFileId = const {}, this.withExplore = true});

  @override
  State<ForYouRails> createState() => _ForYouRailsState();
}

class _ForYouRailsState extends State<ForYouRails> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final store = context.read<OpinionStore>();
      store.ensureLoaded();
      store.loadForYou();
    });
  }

  @override
  Widget build(BuildContext context) {
    final forYou = context.select<OpinionStore, ForYou?>((s) => s.forYou);
    if (forYou == null || !forYou.ready) return const SizedBox.shrink();
    final byKey = {
      for (final item in widget.items) '${item is CatalogFolderItem ? 'folder' : 'video'}:${item.id}': item,
    };
    final library = [
      for (final pick in forYou.library)
        if (byKey['${pick.kind}:${pick.id}'] case final item?) (item: item, reason: pick.reason),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (library.isNotEmpty) _LibraryRail(picks: library, progressByFileId: widget.progressByFileId),
        if (widget.withExplore && forYou.explore.isNotEmpty)
          TitleRail(
            title: 'You might also like',
            eyebrow: 'From what you liked and watched',
            items: forYou.explore,
            showReasons: true,
          ),
      ],
    );
  }
}

class _LibraryRail extends StatelessWidget {
  final List<({CatalogListItem item, String? reason})> picks;
  final Map<String, WatchProgress> progressByFileId;

  const _LibraryRail({required this.picks, required this.progressByFileId});

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final cardWidth = AppLayout.usesSidebar(width) ? 212.0 : 180.0;
    final gutter = AppLayout.gutter(width);
    const reasonHeight = 34.0;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(title: 'For you', padding: EdgeInsets.fromLTRB(gutter, 20, gutter, 2)),
        Padding(
          padding: EdgeInsets.fromLTRB(gutter, 0, gutter, 10),
          child: const Text('From what you liked and watched', style: TextStyle(color: AppColors.textTertiary, fontSize: 12)),
        ),
        SizedBox(
          height: cardWidth * 9 / 16 + MediaCard.textBlockHeight + reasonHeight,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: EdgeInsets.symmetric(horizontal: gutter),
            itemCount: picks.length,
            separatorBuilder: (_, _) => const SizedBox(width: 12),
            itemBuilder: (context, i) => SizedBox(
              width: cardWidth,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(child: MediaCard(item: picks[i].item, progress: progressByFileId[picks[i].item.id])),
                  SizedBox(
                    height: reasonHeight,
                    child: Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: Text(
                        picks[i].reason ?? '',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: AppColors.amber, fontSize: 11.5, height: 1.25),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}
