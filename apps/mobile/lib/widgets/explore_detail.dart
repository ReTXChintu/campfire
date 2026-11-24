import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/title_meta.dart';
import 'trailer_button.dart';
import '../models/explore.dart';
import '../services/api_client.dart';
import '../services/explore_service.dart';
import '../services/requests_service.dart';
import '../theme/app_theme.dart';
import 'tv_focusable.dart';
import 'ui_kit.dart';

/// Opens one Explore title: a panel from the right on a wide screen, a sheet from the bottom on a
/// phone. Resolves when it's closed.
Future<void> showExploreDetail(BuildContext context, {required String tmdbType, required String tmdbId}) {
  final wide = MediaQuery.sizeOf(context).width >= 900;
  final body = ExploreDetailView(tmdbType: tmdbType, tmdbId: tmdbId);
  if (wide) {
    return showGeneralDialog<void>(
      context: context,
      barrierDismissible: true,
      barrierLabel: 'Close details',
      barrierColor: const Color(0xB3000000),
      transitionDuration: const Duration(milliseconds: 220),
      pageBuilder: (context, _, _) => Align(
        alignment: Alignment.centerRight,
        child: Material(
          color: AppColors.bgElevated,
          child: SizedBox(width: 460, height: double.infinity, child: body),
        ),
      ),
      transitionBuilder: (context, animation, _, child) => SlideTransition(
        position: Tween(begin: const Offset(0.25, 0), end: Offset.zero)
            .animate(CurvedAnimation(parent: animation, curve: Curves.easeOutCubic)),
        child: FadeTransition(opacity: animation, child: child),
      ),
    );
  }
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: AppColors.bgElevated,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg))),
    builder: (context) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.86,
      minChildSize: 0.4,
      maxChildSize: 0.95,
      builder: (context, controller) => ExploreDetailView(tmdbType: tmdbType, tmdbId: tmdbId, scrollController: controller),
    ),
  );
}

/// What a title is, where it streams in India, and — when it isn't in Campfire — a way to ask for
/// it (a request with its exact TMDb link, or a vote on one that's already open).
class ExploreDetailView extends StatefulWidget {
  final String tmdbType;
  final String tmdbId;
  final ScrollController? scrollController;

  /// For tests: skips the network.
  final ExploreDetail? initial;

  /// The title's face; the display font by default. (Tests pass a bundled one: the display font
  /// is fetched at run time, which a test can't do.)
  final TextStyle? titleStyle;

  const ExploreDetailView({
    super.key,
    required this.tmdbType,
    required this.tmdbId,
    this.scrollController,
    this.initial,
    this.titleStyle,
  });

  @override
  State<ExploreDetailView> createState() => _ExploreDetailViewState();
}

class _ExploreDetailViewState extends State<ExploreDetailView> {
  ExploreDetail? _detail;
  Object? _error;
  bool _busy = false;
  String? _actionError;
  bool _requested = false;

  @override
  void initState() {
    super.initState();
    _detail = widget.initial;
    if (_detail == null) _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final detail = await ExploreApi.fetchTitle(widget.tmdbType, widget.tmdbId);
      if (mounted) setState(() => _detail = detail);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _request(ExploreDetail d) async {
    setState(() {
      _busy = true;
      _actionError = null;
    });
    try {
      final existing = d.existingRequest;
      if (existing != null) {
        await RequestsService.upvote(existing.id, wantsIt: true);
      } else {
        await RequestsService.create(title: d.title, refLink: d.link);
      }
      if (!mounted) return;
      setState(() => _requested = true);
      await _load();
    } catch (e) {
      if (mounted) setState(() => _actionError = e is ApiException ? e.message : 'That didn\'t go through — try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _detail;
    if (d == null) {
      return Stack(
        children: [
          Center(
            child: _error != null
                ? Padding(
                    padding: const EdgeInsets.all(24),
                    child: ErrorRetry(title: 'That didn\'t load', error: _error, onRetry: _load),
                  )
                : const CircularProgressIndicator(color: AppColors.accent),
          ),
          const Positioned(top: 8, right: 8, child: _CloseButton()),
        ],
      );
    }
    return Stack(
      children: [
        ListView(
          controller: widget.scrollController,
          padding: EdgeInsets.zero,
          children: [
            if (d.backdropUrl != null)
              SizedBox(
                height: 200,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    Image.network(d.backdropUrl!, fit: BoxFit.cover, errorBuilder: (_, _, _) => const SizedBox()),
                    const DecoratedBox(
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.bottomCenter,
                          end: Alignment.center,
                          colors: [AppColors.bgElevated, Color(0x00161412)],
                        ),
                      ),
                    ),
                  ],
                ),
              )
            else
              const SizedBox(height: 52),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _header(d),
                  if (d.tagline != null) ...[
                    const SizedBox(height: 16),
                    Text(d.tagline!, style: const TextStyle(color: AppColors.textTertiary, fontSize: 14, fontStyle: FontStyle.italic)),
                  ],
                  if (d.overview != null) ...[
                    const SizedBox(height: 12),
                    Text(d.overview!, style: const TextStyle(color: Color(0xFFD8D1C6), fontSize: 14, height: 1.55)),
                  ],
                  TrailerButton(
                    tmdb: TmdbRef(type: d.tmdbType, id: d.tmdbId),
                    padding: const EdgeInsets.only(top: 14),
                  ),
                  if (d.libraryRoute != null) ...[const SizedBox(height: 18), _inLibrary(d)],
                  const SizedBox(height: 22),
                  _where(d),
                  if (d.libraryRoute == null) ...[const SizedBox(height: 20), _requestBlock(d)],
                  if (d.cast.isNotEmpty) ...[const SizedBox(height: 24), _cast(d)],
                  const SizedBox(height: 22),
                  const Text(
                    'Availability from JustWatch, via TMDB. "Open" takes you to that service.',
                    style: TextStyle(color: AppColors.textTertiary, fontSize: 11),
                  ),
                ],
              ),
            ),
          ],
        ),
        const Positioned(top: 8, right: 8, child: _CloseButton()),
      ],
    );
  }

  Widget _header(ExploreDetail d) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (d.posterUrl != null)
          ClipRRect(
            borderRadius: BorderRadius.circular(AppRadius.md),
            child: Image.network(d.posterUrl!, width: 96, height: 144, fit: BoxFit.cover, errorBuilder: (_, _, _) => const SizedBox(width: 96, height: 144)),
          ),
        if (d.posterUrl != null) const SizedBox(width: 16),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(d.isSeries ? 'SERIES' : 'FILM',
                  style: const TextStyle(color: AppColors.textTertiary, fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.3)),
              const SizedBox(height: 6),
              Text(d.title, style: (widget.titleStyle ?? AppTheme.display(fontSize: 34)).copyWith(height: 0.95)),
              const SizedBox(height: 8),
              Wrap(
                spacing: 10,
                runSpacing: 4,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  if (d.rating != null)
                    Row(mainAxisSize: MainAxisSize.min, children: [
                      const Icon(Icons.star_rounded, size: 15, color: AppColors.amber),
                      const SizedBox(width: 3),
                      Text(d.rating!.toStringAsFixed(1),
                          style: const TextStyle(color: AppColors.foreground, fontSize: 13, fontWeight: FontWeight.w600)),
                    ]),
                  Text(d.metaLine, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                ],
              ),
              if (d.genres.isNotEmpty) ...[
                const SizedBox(height: 6),
                Text(d.genres.join(' · '), style: const TextStyle(color: AppColors.textTertiary, fontSize: 13)),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _inLibrary(ExploreDetail d) {
    final route = d.libraryRoute!;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.live.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.live.withValues(alpha: 0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('In your Campfire library', style: TextStyle(color: AppColors.live, fontSize: 13, fontWeight: FontWeight.w600)),
          const SizedBox(height: 10),
          _PrimaryButton(
            label: d.inLibrary!.kind == 'folder' ? 'Open in Campfire' : 'Play in Campfire',
            onTap: () {
              final router = GoRouter.of(context);
              Navigator.of(context).pop();
              router.push(route);
            },
          ),
        ],
      ),
    );
  }

  Widget _where(ExploreDetail d) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('WHERE TO WATCH IN INDIA',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 13, fontWeight: FontWeight.w700, letterSpacing: 1.2)),
        const SizedBox(height: 10),
        if (d.stream.isNotEmpty) ..._offerGroup('Stream with a subscription', d.stream),
        if (d.free.isNotEmpty) ..._offerGroup('Free', d.free),
        if (d.rentBuy.isNotEmpty) ..._offerGroup('Rent or buy', d.rentBuy),
        if (d.streamsNowhere)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(AppRadius.md),
              border: Border.all(color: AppColors.divider),
            ),
            child: Text(
              'Not streaming anywhere in India right now.${d.libraryRoute == null ? ' Ask for it on Campfire and it lands on the requests board.' : ''}',
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 14, height: 1.5),
            ),
          ),
      ],
    );
  }

  List<Widget> _offerGroup(String label, List<ExploreOffer> offers) => [
        Text(label, style: const TextStyle(color: AppColors.textTertiary, fontSize: 12)),
        const SizedBox(height: 8),
        for (final o in offers) ...[_OfferRow(offer: o), const SizedBox(height: 8)],
        const SizedBox(height: 6),
      ];

  Widget _requestBlock(ExploreDetail d) {
    final existing = d.existingRequest;
    if (_requested || (existing?.iWantIt ?? false)) {
      final others = (existing?.wantCount ?? 1) - 1;
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.amber.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(AppRadius.md),
          border: Border.all(color: AppColors.amber.withValues(alpha: 0.35)),
        ),
        child: Text(
          'You\'ve asked for this — it\'s on the requests board${others > 0 ? ' with $others other ${others == 1 ? 'vote' : 'votes'}' : ''}.',
          style: const TextStyle(color: AppColors.amber, fontSize: 14),
        ),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (existing != null) ...[
          Text(
            '${existing.wantCount} ${existing.wantCount == 1 ? 'person has' : 'people have'} already asked for this.',
            style: const TextStyle(color: AppColors.textSecondary, fontSize: 14),
          ),
          const SizedBox(height: 8),
          _PrimaryButton(label: _busy ? 'Adding…' : 'Add my vote', onTap: _busy ? null : () => _request(d)),
        ] else ...[
          _OutlineButton(label: _busy ? 'Requesting…' : 'Request on Campfire', onTap: _busy ? null : () => _request(d)),
          const SizedBox(height: 6),
          const Text('Goes on the requests board with this title\'s TMDb link, so it\'s exactly this one.',
              style: TextStyle(color: AppColors.textTertiary, fontSize: 12)),
        ],
        if (_actionError != null) ...[
          const SizedBox(height: 8),
          Text(_actionError!, style: const TextStyle(color: AppColors.danger, fontSize: 13)),
        ],
      ],
    );
  }

  Widget _cast(ExploreDetail d) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('CAST', style: TextStyle(color: AppColors.textSecondary, fontSize: 13, fontWeight: FontWeight.w700, letterSpacing: 1.2)),
        const SizedBox(height: 10),
        // Rows of three that grow with their text (a fixed-ratio grid cut long names off with a
        // large font).
        for (var i = 0; i < d.cast.length; i += 3) ...[
          if (i > 0) const SizedBox(height: 14),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (var j = i; j < i + 3; j++) ...[
                if (j > i) const SizedBox(width: 12),
                Expanded(child: j < d.cast.length ? _person(d.cast[j]) : const SizedBox()),
              ],
            ],
          ),
        ],
      ],
    );
  }
  Widget _person(ExploreCastMember person) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        AspectRatio(
          aspectRatio: 2 / 3,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(AppRadius.md),
            child: person.profileUrl == null
                ? const ColoredBox(color: AppColors.surface)
                : Image.network(person.profileUrl!, fit: BoxFit.cover, errorBuilder: (_, _, _) => const ColoredBox(color: AppColors.surface)),
          ),
        ),
        const SizedBox(height: 6),
        Text(person.name,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: AppColors.foreground, fontSize: 13, fontWeight: FontWeight.w600, height: 1.2)),
        if (person.character != null)
          Text(person.character!,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: AppColors.textTertiary, fontSize: 12, height: 1.2)),
      ],
    );
  }
}

class _CloseButton extends StatelessWidget {
  const _CloseButton();

  @override
  Widget build(BuildContext context) {
    return TvFocusable(
      borderRadius: BorderRadius.circular(AppRadius.pill),
      onTap: () => Navigator.of(context).pop(),
      child: Semantics(
        button: true,
        label: 'Close',
        excludeSemantics: true,
        child: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: const Color(0xCC0E0D0C),
            shape: BoxShape.circle,
            border: Border.all(color: AppColors.dividerStrong),
          ),
          child: const Icon(Icons.close, size: 18, color: AppColors.foreground),
        ),
      ),
    );
  }
}

class _OfferRow extends StatelessWidget {
  final ExploreOffer offer;
  const _OfferRow({required this.offer});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.divider),
      ),
      child: Row(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(9),
            child: offer.logoUrl == null
                ? const SizedBox(width: 36, height: 36, child: ColoredBox(color: AppColors.surfaceHover))
                : Image.network(offer.logoUrl!, width: 36, height: 36, errorBuilder: (_, _, _) => const SizedBox(width: 36, height: 36)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(offer.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: AppColors.foreground, fontSize: 14, fontWeight: FontWeight.w600)),
          ),
          const SizedBox(width: 8),
          TvFocusable(
            borderRadius: BorderRadius.circular(9),
            onTap: () => launchUrl(Uri.parse(offer.url), mode: LaunchMode.externalApplication),
            child: Semantics(
              button: true,
              label: 'Open on ${offer.name}',
              excludeSemantics: true,
              child: Container(
                height: 36,
                padding: const EdgeInsets.symmetric(horizontal: 14),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(9),
                  border: Border.all(color: AppColors.dividerStrong),
                ),
                child: const Text('Open', style: TextStyle(color: AppColors.foreground, fontSize: 13, fontWeight: FontWeight.w600)),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PrimaryButton extends StatelessWidget {
  final String label;
  final VoidCallback? onTap;
  const _PrimaryButton({required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return TvFocusable(
      borderRadius: BorderRadius.circular(10),
      onTap: onTap ?? () {},
      child: Opacity(
        opacity: onTap == null ? 0.6 : 1,
        child: Container(
          height: 44,
          padding: const EdgeInsets.symmetric(horizontal: 20),
          alignment: Alignment.center,
          decoration: BoxDecoration(color: AppColors.accent, borderRadius: BorderRadius.circular(10)),
          child: Text(label, style: const TextStyle(color: AppColors.onAccent, fontSize: 14, fontWeight: FontWeight.w700)),
        ),
      ),
    );
  }
}

class _OutlineButton extends StatelessWidget {
  final String label;
  final VoidCallback? onTap;
  const _OutlineButton({required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return TvFocusable(
      borderRadius: BorderRadius.circular(10),
      onTap: onTap ?? () {},
      child: Opacity(
        opacity: onTap == null ? 0.6 : 1,
        child: Container(
          height: 44,
          padding: const EdgeInsets.symmetric(horizontal: 20),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.accent),
          ),
          child: Text(label, style: const TextStyle(color: Color(0xFFFF8A63), fontSize: 14, fontWeight: FontWeight.w700)),
        ),
      ),
    );
  }
}
