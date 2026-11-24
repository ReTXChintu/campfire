import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../models/catalog.dart';
import '../services/catalog_service.dart';
import '../services/watch_events.dart';
import '../theme/app_theme.dart';
import '../utils/media_meta.dart';
import '../widgets/authed_network_image.dart';
import '../widgets/title_meta_views.dart';
import '../models/title_meta.dart';
import '../widgets/media_card.dart';
import '../widgets/trailer_button.dart';
import '../widgets/tv_focusable.dart';
import '../widgets/ui_kit.dart';

/// Title / Series detail — the hero still, the metadata row, a primary Play (or Resume) action,
/// the season picker and the episode list, per the approved prototypes.
///
/// A synopsis, cast, runtime and rating are not shown because the backend has no such fields;
/// year and quality come from [MediaMeta] when the name carries them. Everything else on screen
/// (season list, per-episode progress, specials) is real API data.
class FolderScreen extends StatefulWidget {
  final String folderId;

  const FolderScreen({super.key, required this.folderId});

  @override
  State<FolderScreen> createState() => _FolderScreenState();
}

class _FolderScreenState extends State<FolderScreen> {
  String? _season;
  late Future<FolderResponse> _future;

  // The last successful load. Kept so a background refresh (see [_onPlayerClosed]) swaps the
  // episode list in place instead of flashing the skeleton.
  FolderResponse? _last;

  @override
  void initState() {
    super.initState();
    _future = _track(CatalogService.fetchFolder(widget.folderId));
    WatchEvents.playerClosed.addListener(_onPlayerClosed);
  }

  @override
  void dispose() {
    WatchEvents.playerClosed.removeListener(_onPlayerClosed);
    super.dispose();
  }

  Future<FolderResponse> _track(Future<FolderResponse> future) {
    return future.then((value) {
      _last = value;
      return value;
    });
  }

  /// Back from the player: the bar on the episode you just watched (and Resume's target) changed.
  void _onPlayerClosed() {
    if (!mounted || _last == null) return;
    CatalogService.fetchFolder(widget.folderId, season: _season).then((value) {
      if (!mounted) return;
      setState(() {
        _last = value;
        _future = Future.value(value);
      });
    }).catchError((_) {});
  }

  void _selectSeason(String seasonId) {
    setState(() {
      _season = seasonId;
      _future = _track(CatalogService.fetchFolder(widget.folderId, season: seasonId));
    });
  }

  void _reload() {
    setState(() {
      _future = _track(CatalogService.fetchFolder(widget.folderId, season: _season));
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: FutureBuilder<FolderResponse>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const _DetailSkeleton();
          }
          if (snapshot.hasError) {
            return SafeArea(
              child: ListView(
                children: [
                  const _BackRow(),
                  ErrorRetry(
                    title: "Couldn't open this title",
                    error: snapshot.error,
                    onRetry: _reload,
                  ),
                ],
              ),
            );
          }

          final data = snapshot.data!;
          final progressByFileId = {for (final p in data.progress) p.fileId: p};
          final episodes = data.isSeries ? data.seasonItems : data.items;
          final resume = _resumeTarget(episodes, progressByFileId);
          final width = MediaQuery.sizeOf(context).width;
          final gutter = AppLayout.gutter(width);

          return ListView(
            padding: const EdgeInsets.only(bottom: 32),
            children: [
              _Hero(data: data),
              Padding(
                padding: EdgeInsets.fromLTRB(gutter, 14, gutter, 0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    TitleWordmark(
                      path: data.meta.hasLogo
                          ? '/api/thumbnail-folder/${data.folderId}?shape=logo'
                          : null,
                      title: data.title,
                      textStyle: AppTheme.display(fontSize: 34),
                      maxHeight: 74,
                    ),
                    const SizedBox(height: 6),
                    MetaLine(
                      meta: data.meta,
                      // What this library actually holds, which is often not what TMDb lists.
                      extra: [
                        data.isSeries
                            ? '${data.seasons.length} ${data.seasons.length == 1 ? "season" : "seasons"} here'
                            : '${episodes.length} ${episodes.length == 1 ? "title" : "titles"}',
                        if (data.isSeries && episodes.isNotEmpty) '${episodes.length} in this season',
                      ],
                    ),
                    if (data.languages?.isEmpty == false) ...[
                      const SizedBox(height: 8),
                      TitleLanguagesLine(languages: data.languages),
                    ],
                    if (data.meta.tagline != null) ...[
                      const SizedBox(height: 8),
                      Text(
                        data.meta.tagline!,
                        style: const TextStyle(
                          color: AppColors.textTertiary,
                          fontSize: 12.5,
                          fontStyle: FontStyle.italic,
                        ),
                      ),
                    ],
                    if (data.meta.overview != null) ...[
                      const SizedBox(height: 10),
                      _Synopsis(text: data.meta.overview!),
                    ],
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        if (resume != null)
                          FilledButton.icon(
                            onPressed: () => context.push('/watch/${resume.item.id}'),
                            icon: const Icon(Icons.play_arrow, size: 20),
                            label: Text(resume.resuming ? 'Resume' : 'Play'),
                          ),
                        if (resume != null) const SizedBox(width: 10),
                        if (resume?.resuming == true)
                          Expanded(
                            child: Text(
                              MediaMeta.parse(resume!.item.name).title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(color: AppColors.textTertiary, fontSize: 12),
                            ),
                          ),
                      ],
                    ),
                    if (data.meta.tmdb != null)
                      TrailerButton(
                        key: ValueKey('trailer-${data.folderId}'),
                        tmdb: data.meta.tmdb!,
                        padding: const EdgeInsets.only(top: 10),
                      ),
                    if (data.isSeries && data.seasons.length > 1) ...[
                      const SizedBox(height: 18),
                      _SeasonPicker(
                        seasons: data.seasons,
                        selectedId: _season ?? data.selectedSeasonId ?? data.seasons.first.id,
                        onChanged: _selectSeason,
                      ),
                    ],
                  ],
                ),
              ),
              CastRow(cast: data.meta.cast, gutter: gutter),
              if (data.isSeries) ...[
                const SizedBox(height: 10),
                for (var i = 0; i < episodes.length; i++)
                  _EpisodeRow(
                    item: episodes[i],
                    progress: progressByFileId[episodes[i].id],
                    gutter: gutter,
                    autofocus: i == 0,
                  ),
                if (episodes.isEmpty)
                  const EmptyState(
                    icon: Icons.playlist_remove,
                    title: 'This season is empty',
                    body: 'Nothing has been published under this season yet.',
                  ),
                if (data.specialItems.isNotEmpty) ...[
                  SectionHeader(
                    title: 'Specials',
                    padding: EdgeInsets.fromLTRB(gutter, 24, gutter, 10),
                  ),
                  MediaGrid(
                    items: data.specialItems,
                    progressByFileId: progressByFileId,
                    padding: EdgeInsets.symmetric(horizontal: gutter),
                  ),
                ],
              ] else ...[
                const SizedBox(height: 18),
                if (episodes.isEmpty)
                  const EmptyState(
                    icon: Icons.playlist_remove,
                    title: 'This folder is empty',
                    body: 'Nothing published in here yet.',
                  )
                else
                  MediaGrid(
                    items: episodes,
                    progressByFileId: progressByFileId,
                    autofocusFirstItem: true,
                    padding: EdgeInsets.symmetric(horizontal: gutter),
                  ),
              ],
            ],
          );
        },
      ),
    );
  }

  /// The first episode with progress but not finished, else the first unwatched one, else the
  /// first item — the same "what does Play mean here" question the rails answer.
  _ResumeTarget? _resumeTarget(
    List<CatalogListItem> items,
    Map<String, WatchProgress> progressByFileId,
  ) {
    final videos = items.whereType<CatalogVideoItem>().toList();
    if (videos.isEmpty) return null;
    for (final video in videos) {
      final progress = progressByFileId[video.id];
      if (progress != null && !progress.completed && progress.positionSeconds > 5) {
        return _ResumeTarget(item: video, resuming: true);
      }
    }
    for (final video in videos) {
      if (progressByFileId[video.id] == null) {
        return _ResumeTarget(item: video, resuming: false);
      }
    }
    return _ResumeTarget(item: videos.first, resuming: false);
  }
}

class _ResumeTarget {
  final CatalogVideoItem item;
  final bool resuming;
  const _ResumeTarget({required this.item, required this.resuming});
}

class _BackRow extends StatelessWidget {
  const _BackRow();

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: IconButton(
        tooltip: 'Back',
        icon: const Icon(Icons.arrow_back, color: AppColors.foreground),
        onPressed: () => context.canPop() ? context.pop() : context.go('/'),
      ),
    );
  }
}

class _Hero extends StatelessWidget {
  final FolderResponse data;
  const _Hero({required this.data});

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final height = (width * 9 / 16).clamp(220.0, 420.0);

    return SizedBox(
      height: height,
      child: Stack(
        fit: StackFit.expand,
        children: [
          if (data.thumbnailFileId != null)
            AuthedNetworkImage(path: '/api/thumbnail-folder/${data.folderId}')
          else
            const ColoredBox(color: AppColors.surface),
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.bottomCenter,
                end: Alignment.topCenter,
                colors: [AppColors.background, Colors.transparent],
                stops: [0.02, 0.75],
              ),
            ),
          ),
          Positioned(
            top: 0,
            left: 0,
            child: SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: TvFocusable(
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                  onTap: () => context.canPop() ? context.pop() : context.go('/'),
                  child: Container(
                    width: 44,
                    height: 44,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.55),
                      borderRadius: BorderRadius.circular(AppRadius.pill),
                    ),
                    child: const Icon(Icons.arrow_back, color: AppColors.foreground, size: 22),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// A series' TMDb synopsis: three lines, tap for the rest.
class _Synopsis extends StatefulWidget {
  final String text;
  const _Synopsis({required this.text});

  @override
  State<_Synopsis> createState() => _SynopsisState();
}

class _SynopsisState extends State<_Synopsis> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: _expanded ? 'Synopsis, tap to collapse' : 'Synopsis, tap to read all',
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () => setState(() => _expanded = !_expanded),
        child: Text(
          widget.text,
          maxLines: _expanded ? null : 3,
          overflow: _expanded ? TextOverflow.visible : TextOverflow.ellipsis,
          style: const TextStyle(color: AppColors.textSecondary, fontSize: 13.5, height: 1.45),
        ),
      ),
    );
  }
}

class _SeasonPicker extends StatelessWidget {
  final List<Season> seasons;
  final String selectedId;
  final ValueChanged<String> onChanged;

  const _SeasonPicker({
    required this.seasons,
    required this.selectedId,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final current = seasons.firstWhere(
      (s) => s.id == selectedId,
      orElse: () => seasons.first,
    );

    return Align(
      alignment: Alignment.centerLeft,
      child: Semantics(
        button: true,
        label: 'Season: ${current.name}',
        child: TvFocusable(
          borderRadius: BorderRadius.circular(AppRadius.pill),
          onTap: () async {
            final picked = await showOptionPicker<String>(
              context: context,
              title: 'Season',
              selected: selectedId,
              options: [
                for (final season in seasons) PickerOption(value: season.id, label: season.name),
              ],
            );
            if (picked != null && picked != selectedId) onChanged(picked);
          },
          child: Container(
            height: 44,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(AppRadius.pill),
              border: Border.all(color: AppColors.dividerStrong),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  current.name,
                  style: const TextStyle(
                    color: AppColors.foreground,
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(width: 8),
                const Icon(Icons.expand_more, size: 18, color: AppColors.textSecondary),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _EpisodeRow extends StatelessWidget {
  final CatalogListItem item;
  final WatchProgress? progress;
  final double gutter;
  final bool autofocus;

  const _EpisodeRow({
    required this.item,
    required this.progress,
    required this.gutter,
    this.autofocus = false,
  });

  @override
  Widget build(BuildContext context) {
    final isFolder = item is CatalogFolderItem;
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
    // TMDb's own episode number, which is what an "E4" label should read. Null for anything that
    // isn't an episode of a matched series, and the row then looks exactly as it always did.
    final episodeLabel = video?.episodeNumber == null
        ? null
        : 'E${video!.episodeNumber}';
    final secondLine = [
      if (meta.hasAny) meta.line,
      ?runtimeLabel(video?.runtimeMinutes),
      ?remaining,
    ];

    return TvFocusable(
      autofocus: autofocus,
      borderRadius: BorderRadius.circular(AppRadius.sm),
      onTap: () => isFolder ? context.push('/folder/${item.id}') : context.push('/watch/${item.id}'),
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: gutter, vertical: 12),
        decoration: const BoxDecoration(
          border: Border(bottom: BorderSide(color: AppColors.divider)),
        ),
        child: Row(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(AppRadius.sm),
              child: SizedBox(
                width: 124,
                height: 70,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    if (isFolder)
                      const ColoredBox(
                        color: AppColors.surface,
                        child: Icon(
                          Icons.folder_outlined,
                          color: AppColors.textTertiary,
                          size: 22,
                        ),
                      )
                    else
                      AuthedNetworkImage(path: '/api/thumbnail/${item.id}'),
                    if (progress?.completed == true)
                      const Positioned(
                        right: 4,
                        top: 4,
                        child: CircleAvatar(
                          radius: 8,
                          backgroundColor: AppColors.live,
                          child: Icon(Icons.check, size: 11, color: AppColors.onAccent),
                        ),
                      ),
                    if (percent > 0)
                      Positioned(
                        left: 0,
                        right: 0,
                        bottom: 0,
                        child: Container(
                          height: 3,
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
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (episodeLabel != null || video?.rating != null) ...[
                    Row(
                      children: [
                        if (episodeLabel != null)
                          Text(
                            episodeLabel,
                            style: const TextStyle(
                              color: AppColors.amber,
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              letterSpacing: 0.4,
                            ),
                          ),
                        if (episodeLabel != null && video?.rating != null) const SizedBox(width: 8),
                        RatingChip(rating: video?.rating, fontSize: 11),
                      ],
                    ),
                    const SizedBox(height: 2),
                  ],
                  Text(
                    meta.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppColors.foreground,
                      fontSize: 13.5,
                      fontWeight: FontWeight.w600,
                      height: 1.3,
                    ),
                  ),
                  if (video?.overview != null) ...[
                    const SizedBox(height: 3),
                    Text(
                      video!.overview!,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: AppColors.textSecondary, fontSize: 11.5, height: 1.35),
                    ),
                  ],
                  if (secondLine.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      secondLine.join(' · '),
                      style: const TextStyle(color: AppColors.textTertiary, fontSize: 11.5),
                    ),
                  ],
                ],
              ),
            ),
            const Icon(Icons.play_circle_outline, size: 22, color: AppColors.textSecondary),
          ],
        ),
      ),
    );
  }
}

class _DetailSkeleton extends StatelessWidget {
  const _DetailSkeleton();

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final gutter = AppLayout.gutter(width);
    return ListView(
      physics: const NeverScrollableScrollPhysics(),
      children: [
        Shimmer(height: (width * 9 / 16).clamp(220.0, 420.0), radius: 0),
        Padding(
          padding: EdgeInsets.fromLTRB(gutter, 16, gutter, 0),
          child: const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Shimmer(width: 220, height: 30, radius: 6),
              SizedBox(height: 12),
              Shimmer(width: 140, height: 13, radius: 4),
              SizedBox(height: 18),
              Shimmer(width: 130, height: 46, radius: AppRadius.pill),
            ],
          ),
        ),
        const SizedBox(height: 20),
        for (var i = 0; i < 4; i++)
          Padding(
            padding: EdgeInsets.fromLTRB(gutter, 0, gutter, 14),
            child: const Row(
              children: [
                Shimmer(width: 124, height: 70, radius: AppRadius.sm),
                SizedBox(width: 12),
                Expanded(child: Shimmer(height: 14, radius: 4)),
              ],
            ),
          ),
      ],
    );
  }
}
