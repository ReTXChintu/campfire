import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../models/play.dart';
import '../services/title_service.dart';
import '../theme/app_theme.dart';
import 'tv_focusable.dart';
import 'ui_kit.dart';

/// Leaves the details panel this sits in and plays the title from [source] (web
/// apps/frontend/src/lib/play.ts `playHref`). The router is read before the panel closes.
void playFrom(BuildContext context, {required String type, required String id, int? season, int? episode, required String source}) {
  final router = GoRouter.of(context);
  Navigator.of(context).maybePop();
  router.push(playRoute(type: type, id: id, season: season, episode: episode, source: source));
}

/// What a Play button opens: the sources added in admin, each playing the title from itself
/// (web components/explore/SourceMenu.tsx). Whether a source has it is only known by trying it.
class SourceMenu extends StatefulWidget {
  final String type;
  final String id;
  final int? season;
  final int? episode;

  const SourceMenu({super.key, required this.type, required this.id, this.season, this.episode});

  @override
  State<SourceMenu> createState() => _SourceMenuState();
}

class _SourceMenuState extends State<SourceMenu> {
  late Future<List<ViewerSource>> _sources = TitleService.fetchSources();

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<ViewerSource>>(
      future: _sources,
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return Row(
            children: [
              const Expanded(
                child: Text('The sources did not load.', style: TextStyle(color: AppColors.danger, fontSize: 13)),
              ),
              TextButton(
                onPressed: () => setState(() => _sources = TitleService.fetchSources()),
                child: const Text('Try again'),
              ),
            ],
          );
        }
        final sources = snapshot.data;
        if (sources == null) return const Shimmer(height: 52, radius: AppRadius.md);
        if (sources.isEmpty) {
          return const Text('There is nowhere to play this from yet.',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 13));
        }
        return Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final (i, source) in sources.indexed)
              SourceChoice(
                name: source.name,
                autofocus: i == 0,
                onTap: () => playFrom(
                  context,
                  type: widget.type,
                  id: widget.id,
                  season: widget.season,
                  episode: widget.episode,
                  source: source.id,
                ),
              ),
          ],
        );
      },
    );
  }
}

/// One source to pick: "Play from" and its name.
class SourceChoice extends StatelessWidget {
  final String name;
  final VoidCallback onTap;
  final bool autofocus;

  const SourceChoice({super.key, required this.name, required this.onTap, this.autofocus = false});

  @override
  Widget build(BuildContext context) {
    return TvFocusable(
      autofocus: autofocus,
      borderRadius: BorderRadius.circular(AppRadius.md),
      onTap: onTap,
      child: Semantics(
        button: true,
        label: 'Play from $name',
        excludeSemantics: true,
        child: Container(
          constraints: const BoxConstraints(minWidth: 150, minHeight: 52),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(AppRadius.md),
            border: Border.all(color: AppColors.dividerStrong),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 32,
                height: 32,
                decoration: const BoxDecoration(color: AppColors.foreground, shape: BoxShape.circle),
                child: const Icon(Icons.play_arrow_rounded, size: 20, color: AppColors.background),
              ),
              const SizedBox(width: 10),
              Flexible(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Play from', style: TextStyle(color: AppColors.textTertiary, fontSize: 11)),
                    Text(name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: AppColors.foreground, fontSize: 14, fontWeight: FontWeight.w700)),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// How many episodes show before "Show all".
const _firstEpisodes = 10;

/// A series' episodes, a season at a time, opened on the one the viewer is in (web
/// components/explore/EpisodeList.tsx). Picking one opens its sources under it.
class SeriesEpisodeList extends StatefulWidget {
  final String seriesId;

  /// The season and episode Play means, once known — the panel's Play button names it.
  final ValueChanged<SeriesEpisodes>? onLoaded;

  const SeriesEpisodeList({super.key, required this.seriesId, this.onLoaded});

  @override
  State<SeriesEpisodeList> createState() => _SeriesEpisodeListState();
}

class _SeriesEpisodeListState extends State<SeriesEpisodeList> {
  SeriesEpisodes? _data;
  Object? _error;
  bool _loading = false;
  bool _all = false;
  int? _open;
  bool _first = true;

  @override
  void initState() {
    super.initState();
    _load(null);
  }

  Future<void> _load(int? season) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await TitleService.fetchEpisodes(widget.seriesId, season: season);
      if (!mounted) return;
      setState(() {
        _data = data;
        _all = false;
        _open = null;
      });
      if (_first) widget.onLoaded?.call(data);
      _first = false;
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pickSeason(SeriesEpisodes data) async {
    final picked = await showOptionPicker<int>(
      context: context,
      title: 'Season',
      options: [for (final s in data.seasons) PickerOption(value: s.number, label: '${s.name} (${s.count})')],
      selected: data.season,
    );
    if (picked != null && picked != data.season) _load(picked);
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    if (data == null) {
      // A series TMDb has no episodes for simply has no list.
      if (_error != null) return const SizedBox.shrink();
      return const Shimmer(height: 220, radius: AppRadius.md);
    }
    final resumeAt =
        data.resume.season == data.season ? data.episodes.indexWhere((e) => e.number == data.resume.episode) : -1;
    final limit = _all ? data.episodes.length : (resumeAt + 2).clamp(_firstEpisodes, data.episodes.length);
    final current = data.seasons.where((s) => s.number == data.season).firstOrNull;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Expanded(
              child: Text('EPISODES',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 13, fontWeight: FontWeight.w700, letterSpacing: 1.2)),
            ),
            if (data.seasons.length > 1)
              OutlinedButton.icon(
                onPressed: () => _pickSeason(data),
                icon: const Icon(Icons.expand_more, size: 18),
                label: Text(current?.name ?? 'Season ${data.season}'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.foreground,
                  side: const BorderSide(color: AppColors.dividerStrong),
                  minimumSize: const Size(0, 40),
                ),
              ),
          ],
        ),
        const SizedBox(height: 8),
        Opacity(
          opacity: _loading ? 0.5 : 1,
          child: Column(
            children: [
              for (final e in data.episodes.take(limit)) ...[
                _EpisodeRow(
                  episode: e,
                  open: _open == e.number,
                  onTap: e.aired ? () => setState(() => _open = _open == e.number ? null : e.number) : null,
                ),
                if (_open == e.number)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(8, 4, 8, 14),
                    child: SourceMenu(type: 'tv', id: widget.seriesId, season: data.season, episode: e.number),
                  ),
                const Divider(height: 1, color: AppColors.divider),
              ],
            ],
          ),
        ),
        if (data.episodes.length > limit)
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: OutlinedButton(
              onPressed: () => setState(() => _all = true),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.foreground,
                side: const BorderSide(color: AppColors.dividerStrong),
              ),
              child: Text('Show all ${data.episodes.length}'),
            ),
          ),
      ],
    );
  }
}

class _EpisodeRow extends StatelessWidget {
  final SeriesEpisode episode;
  final bool open;
  final VoidCallback? onTap;

  const _EpisodeRow({required this.episode, required this.open, required this.onTap});

  String? get _facts {
    final parts = <String>[
      if (episode.completed) 'Watched',
      if (!episode.aired) 'Not out yet',
      if (episode.runtimeMinutes != null) '${episode.runtimeMinutes}m',
      if (episode.airDate != null) episode.airDate!,
    ];
    return parts.isEmpty ? null : parts.join(' · ');
  }

  @override
  Widget build(BuildContext context) {
    final progress = episode.progress;
    final row = Padding(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 26,
            child: Text('${episode.number}',
                textAlign: TextAlign.center, style: AppTheme.display(fontSize: 22).copyWith(color: AppColors.textTertiary)),
          ),
          const SizedBox(width: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(AppRadius.sm),
            child: SizedBox(
              width: 128,
              height: 72,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  if (episode.stillUrl != null)
                    Image.network(episode.stillUrl!, fit: BoxFit.cover, errorBuilder: (_, _, _) => const ColoredBox(color: AppColors.surface))
                  else
                    const ColoredBox(color: AppColors.surface),
                  if (progress > 0)
                    Align(
                      alignment: Alignment.bottomLeft,
                      child: Container(
                        height: 3,
                        color: Colors.white24,
                        child: FractionallySizedBox(
                          widthFactor: progress,
                          alignment: Alignment.centerLeft,
                          child: ColoredBox(color: episode.completed ? AppColors.live : AppColors.accent),
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
                Text(episode.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: AppColors.foreground, fontSize: 14, fontWeight: FontWeight.w600)),
                if (_facts != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(_facts!, style: const TextStyle(color: AppColors.textTertiary, fontSize: 12)),
                  ),
                if (episode.overview != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(episode.overview!,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: AppColors.textSecondary, fontSize: 12, height: 1.4)),
                  ),
              ],
            ),
          ),
          if (onTap != null)
            Padding(
              padding: const EdgeInsets.only(left: 6, top: 20),
              child: Icon(open ? Icons.expand_less : Icons.play_circle_outline, color: AppColors.textSecondary),
            ),
        ],
      ),
    );
    if (onTap == null) return Opacity(opacity: 0.5, child: row);
    return TvFocusable(
      borderRadius: BorderRadius.circular(AppRadius.md),
      onTap: onTap!,
      child: Semantics(button: true, label: 'Play episode ${episode.number}, ${episode.name}', child: row),
    );
  }
}
