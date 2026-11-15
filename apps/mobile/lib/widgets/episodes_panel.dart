import 'package:flutter/material.dart';
import '../models/catalog.dart';
import '../theme/app_theme.dart';
import '../utils/media_meta.dart';
import 'tv_focusable.dart';

/// The in-player episode list (landscape: a side panel over the video). Every episode shows how
/// much of it you've watched — a full bar and a check for the finished ones — so a glance down the
/// list answers "have I seen all of these?".
class EpisodesPanel extends StatelessWidget {
  final List<EpisodeRef> episodes;
  final Map<String, EpisodeProgress> progressByFileId;
  final String currentFileId;
  final ValueChanged<String> onSelect;
  final VoidCallback onClose;

  const EpisodesPanel({
    super.key,
    required this.episodes,
    required this.progressByFileId,
    required this.currentFileId,
    required this.onSelect,
    required this.onClose,
  });

  @override
  Widget build(BuildContext context) {
    final watched = episodes.where((e) => progressByFileId[e.id]?.completed ?? false).length;
    return Positioned.fill(
      child: Row(
        children: [
          Expanded(child: GestureDetector(onTap: onClose, child: Container(color: Colors.black54))),
          Container(
            width: 340,
            decoration: const BoxDecoration(
              color: AppColors.bgElevated,
              border: Border(left: BorderSide(color: AppColors.dividerStrong)),
            ),
            child: SafeArea(
              left: false,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 10, 4, 6),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('EPISODES', style: AppTheme.display(fontSize: 20)),
                              Text(
                                '$watched of ${episodes.length} watched',
                                style: const TextStyle(color: AppColors.textTertiary, fontSize: 11.5),
                              ),
                            ],
                          ),
                        ),
                        IconButton(
                          tooltip: 'Close',
                          icon: const Icon(Icons.close, color: AppColors.textSecondary),
                          onPressed: onClose,
                        ),
                      ],
                    ),
                  ),
                  const Divider(height: 1, color: AppColors.divider),
                  Expanded(
                    child: ListView.builder(
                      itemCount: episodes.length,
                      itemBuilder: (context, index) {
                        final episode = episodes[index];
                        final isCurrent = episode.id == currentFileId;
                        return EpisodeListRow(
                          number: index + 1,
                          episode: episode,
                          progress: progressByFileId[episode.id],
                          current: isCurrent,
                          gutter: 14,
                          onTap: () {
                            onClose();
                            if (!isCurrent) onSelect(episode.id);
                          },
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// One episode: number, title, a progress bar under it (full + check when finished), and a
/// "Now playing" marker on the current one.
class EpisodeListRow extends StatelessWidget {
  final int number;
  final EpisodeRef episode;
  final EpisodeProgress? progress;
  final bool current;
  final double gutter;
  final VoidCallback onTap;

  const EpisodeListRow({
    super.key,
    required this.number,
    required this.episode,
    required this.progress,
    required this.current,
    required this.gutter,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final title = MediaMeta.parse(episode.name).title;
    final fraction = progress?.fraction ?? 0;
    final done = progress?.completed ?? false;
    final status = current
        ? 'Now playing'
        : done
            ? 'Watched'
            : fraction > 0
                ? '${(fraction * 100).round()}% watched'
                : null;

    return TvFocusable(
      autofocus: current,
      onTap: onTap,
      child: Semantics(
        button: true,
        label: ['Episode $number', title, ?status].join(', '),
        excludeSemantics: true,
        child: Container(
          padding: EdgeInsets.symmetric(horizontal: gutter, vertical: 11),
          decoration: BoxDecoration(
            color: current ? AppColors.accentSoft : null,
            border: const Border(bottom: BorderSide(color: AppColors.divider)),
          ),
          child: Row(
            children: [
              SizedBox(
                width: 28,
                child: done
                    ? const Icon(Icons.check_circle, size: 18, color: AppColors.live)
                    : Text(
                        '$number',
                        style: TextStyle(
                          color: current ? AppColors.accent : AppColors.textTertiary,
                          fontWeight: FontWeight.w700,
                          fontSize: 13,
                        ),
                      ),
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: current ? AppColors.foreground : AppColors.textSecondary,
                        fontSize: 13.5,
                        fontWeight: current ? FontWeight.w700 : FontWeight.w500,
                      ),
                    ),
                    if (fraction > 0 || current) ...[
                      const SizedBox(height: 6),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(2),
                        child: SizedBox(
                          height: 3,
                          child: Stack(
                            fit: StackFit.expand,
                            children: [
                              const ColoredBox(color: AppColors.dividerStrong),
                              FractionallySizedBox(
                                alignment: Alignment.centerLeft,
                                widthFactor: fraction,
                                child: ColoredBox(color: done ? AppColors.live : AppColors.accent),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                    if (status != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        status,
                        style: TextStyle(
                          color: current ? AppColors.accent : (done ? AppColors.live : AppColors.textTertiary),
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
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
