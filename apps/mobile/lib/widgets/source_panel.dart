import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/explore.dart';
import '../models/play.dart';
import '../models/title_meta.dart';
import '../services/explore_service.dart';
import '../theme/app_theme.dart';

/// In place of the player: the sources to pick from, when none is picked yet or the one that was
/// doesn't have the title or couldn't play it (web components/SourcePanel.tsx). Nothing is tried by
/// itself — the viewer picks.
class SourcePanel extends StatefulWidget {
  final String title;

  /// The title on TMDb, for where else it streams once a source hasn't got it.
  final TmdbRef? tmdb;
  final List<ViewerSource> sources;

  /// The one that didn't play it; null when none is picked yet.
  final ViewerSource? failed;
  final ValueChanged<String> onSelect;
  final VoidCallback onBack;

  const SourcePanel({
    super.key,
    required this.title,
    required this.tmdb,
    required this.sources,
    required this.failed,
    required this.onSelect,
    required this.onBack,
  });

  @override
  State<SourcePanel> createState() => _SourcePanelState();
}

class _SourcePanelState extends State<SourcePanel> {
  ExploreDetail? _where;

  @override
  void initState() {
    super.initState();
    final tmdb = widget.tmdb;
    // Where else it streams only matters once a source hasn't got it.
    if (widget.failed != null && tmdb != null) {
      ExploreApi.fetchTitle(tmdb.type, tmdb.id).then((d) {
        if (mounted) setState(() => _where = d);
      }).catchError((_) {});
    }
  }

  @override
  Widget build(BuildContext context) {
    final failed = widget.failed;
    final others = widget.sources.where((s) => s.id != failed?.id).toList();
    final gutter = AppLayout.gutter(MediaQuery.sizeOf(context).width);
    final where = _where;
    final offers = where == null ? const <ExploreOffer>[] : [...where.stream, ...where.free, ...where.rentBuy];

    return ColoredBox(
      color: AppColors.background,
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Align(
              alignment: Alignment.centerLeft,
              child: IconButton(
                tooltip: 'Back',
                icon: const Icon(Icons.arrow_back, color: AppColors.foreground),
                onPressed: widget.onBack,
              ),
            ),
            Expanded(
              child: ListView(
                padding: EdgeInsets.fromLTRB(gutter, 8, gutter, 32),
                children: [
                  Semantics(
                    liveRegion: failed != null,
                    child: Text(failed != null ? 'Not found here' : 'Play from', style: AppTheme.display(fontSize: 36)),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    failed != null
                        ? '${widget.title} didn\'t play from ${failed.name}.${others.isNotEmpty ? ' Try another source.' : ''}'
                        : widget.title,
                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 15, height: 1.4),
                  ),
                  const SizedBox(height: 20),
                  if (widget.sources.isEmpty)
                    const Text(
                      'No sources are set up to play from yet.',
                      style: TextStyle(color: AppColors.textTertiary, fontSize: 14),
                    ),
                  Wrap(
                    spacing: 12,
                    runSpacing: 12,
                    children: [
                      for (final (i, source) in others.indexed)
                        _SourceButton(name: source.name, autofocus: i == 0, onTap: () => widget.onSelect(source.id)),
                    ],
                  ),
                  if (failed != null) ...[
                    const SizedBox(height: 16),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: OutlinedButton(
                        autofocus: others.isEmpty,
                        onPressed: () => widget.onSelect(failed.id),
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size(0, 44),
                          foregroundColor: AppColors.foreground,
                          side: const BorderSide(color: AppColors.dividerStrong),
                        ),
                        child: Text('Try ${failed.name} again'),
                      ),
                    ),
                  ],
                  if (offers.isNotEmpty) ...[
                    const SizedBox(height: 28),
                    const Text(
                      'WHERE ELSE IT STREAMS IN INDIA',
                      style: TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 1.2,
                      ),
                    ),
                    const SizedBox(height: 10),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final offer in offers)
                          ActionChip(
                            backgroundColor: AppColors.surface,
                            side: const BorderSide(color: AppColors.divider),
                            label: Text(offer.name, style: const TextStyle(color: AppColors.foreground)),
                            avatar: const Icon(Icons.open_in_new, size: 16, color: AppColors.textSecondary),
                            onPressed: () =>
                                launchUrl(Uri.parse(offer.url), mode: LaunchMode.externalApplication).catchError((_) => false),
                          ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Availability from JustWatch, via TMDB.',
                      style: TextStyle(color: AppColors.textTertiary, fontSize: 11),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SourceButton extends StatelessWidget {
  final String name;
  final bool autofocus;
  final VoidCallback onTap;

  const _SourceButton({required this.name, required this.autofocus, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 240,
      child: OutlinedButton(
        autofocus: autofocus,
        onPressed: onTap,
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(0, 60),
          padding: const EdgeInsets.symmetric(horizontal: 16),
          alignment: Alignment.centerLeft,
          backgroundColor: AppColors.surface,
          foregroundColor: AppColors.foreground,
          side: const BorderSide(color: AppColors.dividerStrong),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.md)),
        ),
        child: Row(
          children: [
            const Icon(Icons.play_circle_fill, color: AppColors.accent, size: 26),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
