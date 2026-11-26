import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../models/catalog.dart';
import '../../models/feed.dart';
import '../../platform_info.dart';
import '../../theme/app_theme.dart';
import '../spotlight_carousel.dart';
import 'title_cards.dart';

/// The top of the feed: what everyone is watching, one title a slide, with the library's newly
/// fulfilled requests second where they're seen (web apps/frontend/src/components/feed/FeedHero.tsx).
/// Advances by itself every 9 s until anyone touches, focuses or hovers it, and never when the
/// platform asks for reduced motion.
class FeedHero extends StatefulWidget {
  final List<TitleItem> hero;

  /// Fulfilled requests (`spotlight` slides of kind "request").
  final List<SpotlightSlide> added;

  const FeedHero({super.key, required this.hero, this.added = const []});

  /// Tall enough to be the page's front, short enough to show the row below it.
  static double heightFor(Size screen) => math.min(math.max(screen.height * 0.62, 380), 640);

  @override
  State<FeedHero> createState() => _FeedHeroState();
}

sealed class _Slide {}

class _TitleSlide extends _Slide {
  final TitleItem item;
  _TitleSlide(this.item);
}

class _AddedSlide extends _Slide {
  final SpotlightSlide slide;
  _AddedSlide(this.slide);
}

class _FeedHeroState extends State<FeedHero> {
  static const _advanceEvery = Duration(seconds: 9);
  static const _resumeAfter = Duration(seconds: 20);

  final _controller = PageController();
  Timer? _advanceTimer;
  Timer? _resumeTimer;
  int _index = 0;
  bool _hovered = false;
  bool _reducedMotion = false;
  bool _sawInitialFocus = false;

  List<_Slide> get _slides {
    final slides = <_Slide>[for (final item in widget.hero) _TitleSlide(item)];
    slides.insertAll(math.min(1, slides.length), [for (final s in widget.added) _AddedSlide(s)]);
    return slides;
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _sync();
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduced = MediaQuery.disableAnimationsOf(context);
    if (reduced != _reducedMotion) {
      _reducedMotion = reduced;
      _sync();
    }
  }

  @override
  void dispose() {
    _advanceTimer?.cancel();
    _resumeTimer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _sync() {
    _advanceTimer?.cancel();
    final auto = _slides.length > 1 && !_reducedMotion && !_hovered && _resumeTimer == null;
    _advanceTimer = auto ? Timer.periodic(_advanceEvery, (_) => _goTo((_index + 1) % _slides.length)) : null;
  }

  void _interacted() {
    _resumeTimer?.cancel();
    _resumeTimer = Timer(_resumeAfter, () {
      _resumeTimer = null;
      if (mounted) _sync();
    });
    _sync();
  }

  void _goTo(int index) {
    if (!_controller.hasClients) return;
    _controller.animateToPage(
      index.clamp(0, _slides.length - 1),
      duration: const Duration(milliseconds: 360),
      curve: Curves.easeOutCubic,
    );
  }

  void _step(int delta) {
    _interacted();
    final next = _index + delta;
    if (next >= 0 && next < _slides.length) _goTo(next);
  }

  @override
  Widget build(BuildContext context) {
    final slides = _slides;
    if (slides.isEmpty) return const SizedBox.shrink();
    final height = FeedHero.heightFor(MediaQuery.sizeOf(context));
    final arrows = slides.length > 1 && (isDesktopAdminCapable || isAndroidTv);

    return Focus(
      skipTraversal: true,
      canRequestFocus: false,
      onKeyEvent: (node, event) {
        if (event is! KeyDownEvent) return KeyEventResult.ignored;
        if (event.logicalKey == LogicalKeyboardKey.arrowRight && _index < slides.length - 1) {
          _step(1);
          return KeyEventResult.handled;
        }
        if (event.logicalKey == LogicalKeyboardKey.arrowLeft && _index > 0) {
          _step(-1);
          return KeyEventResult.handled;
        }
        return KeyEventResult.ignored;
      },
      onFocusChange: (focused) {
        // The first slide's Play autofocuses for TV; that isn't the viewer taking control.
        if (focused && !_sawInitialFocus) {
          _sawInitialFocus = true;
          return;
        }
        _interacted();
      },
      child: MouseRegion(
        onEnter: (_) {
          _hovered = true;
          _sync();
        },
        onExit: (_) {
          _hovered = false;
          _sync();
        },
        child: SizedBox(
          height: height,
          child: Stack(
            children: [
              Listener(
                onPointerDown: (_) => _interacted(),
                child: PageView.builder(
                  controller: _controller,
                  itemCount: slides.length,
                  onPageChanged: (i) => setState(() => _index = i),
                  itemBuilder: (context, i) => switch (slides[i]) {
                    _TitleSlide(:final item) => _TitleSlideView(item: item, autofocusPlay: i == 0),
                    _AddedSlide(:final slide) => SpotlightSlideView(slide: slide),
                  },
                ),
              ),
              if (arrows) ...[
                _Arrow(left: true, onPressed: _index > 0 ? () => _step(-1) : null),
                _Arrow(left: false, onPressed: _index < slides.length - 1 ? () => _step(1) : null),
              ],
              if (slides.length > 1)
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 6,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      for (var i = 0; i < slides.length; i++)
                        Semantics(
                          button: true,
                          selected: i == _index,
                          label: 'Slide ${i + 1} of ${slides.length}',
                          child: InkWell(
                            customBorder: const StadiumBorder(),
                            onTap: () {
                              _interacted();
                              _goTo(i);
                            },
                            child: Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
                              child: AnimatedContainer(
                                duration: const Duration(milliseconds: 180),
                                width: i == _index ? 22 : 8,
                                height: 8,
                                decoration: BoxDecoration(
                                  color: i == _index ? AppColors.accent : Colors.white.withValues(alpha: 0.35),
                                  borderRadius: BorderRadius.circular(4),
                                ),
                              ),
                            ),
                          ),
                        ),
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

class _TitleSlideView extends StatelessWidget {
  final TitleItem item;
  final bool autofocusPlay;

  const _TitleSlideView({required this.item, this.autofocusPlay = false});

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final wide = AppLayout.usesSidebar(width);
    final gutter = AppLayout.gutter(width);
    final title = Text(
      item.title,
      maxLines: 2,
      overflow: TextOverflow.ellipsis,
      style: AppTheme.display(fontSize: wide ? 64 : 44).copyWith(height: 0.95),
    );
    final logo = item.logoUrl;

    return Stack(
      fit: StackFit.expand,
      children: [
        TmdbImage(url: item.backdropUrl ?? item.posterUrl, alignment: const Alignment(0, -0.5)),
        const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.bottomCenter,
              end: Alignment.topCenter,
              colors: [AppColors.background, Color(0x590E0D0C), Color(0x000E0D0C)],
              stops: [0, 0.45, 1],
            ),
          ),
        ),
        const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [Color(0x99000000), Color(0x00000000)],
              stops: [0, 0.6],
            ),
          ),
        ),
        Positioned(
          left: gutter,
          right: gutter,
          bottom: 36,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              if (logo != null)
                ConstrainedBox(
                  constraints: BoxConstraints(maxHeight: wide ? 140 : 88, maxWidth: wide ? 420 : width * 0.7),
                  child: Image.network(
                    logo,
                    fit: BoxFit.contain,
                    alignment: Alignment.bottomLeft,
                    semanticLabel: item.title,
                    errorBuilder: (_, _, _) => title,
                  ),
                )
              else
                title,
              const SizedBox(height: 12),
              ratingLine(
                item,
                [if (item.year != null) '${item.year}', item.kindLabel, ...item.genres.take(2)],
                color: Colors.white.withValues(alpha: 0.85),
                fontSize: 13.5,
              ),
              if (item.overview != null) ...[
                const SizedBox(height: 8),
                ConstrainedBox(
                  // A comfortable line length; the slide itself stays full width.
                  constraints: const BoxConstraints(maxWidth: 620),
                  child: Text(
                    item.overview!,
                    maxLines: wide ? 3 : 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: Colors.white.withValues(alpha: 0.8), fontSize: wide ? 15 : 13.5, height: 1.4),
                  ),
                ),
              ],
              const SizedBox(height: 16),
              Wrap(
                spacing: 10,
                runSpacing: 8,
                children: [
                  FilledButton.icon(
                    autofocus: autofocusPlay,
                    onPressed: () => openTitle(context, item, play: true),
                    icon: const Icon(Icons.play_arrow, size: 20),
                    label: const Text('Play'),
                    style: FilledButton.styleFrom(
                      backgroundColor: Colors.white,
                      foregroundColor: Colors.black,
                      minimumSize: const Size(0, 46),
                      padding: const EdgeInsets.symmetric(horizontal: 22),
                      textStyle: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                  FilledButton.icon(
                    onPressed: () => openTitle(context, item),
                    icon: const Icon(Icons.info_outline, size: 19),
                    label: const Text('More info'),
                    style: FilledButton.styleFrom(
                      backgroundColor: Colors.white.withValues(alpha: 0.16),
                      foregroundColor: Colors.white,
                      minimumSize: const Size(0, 46),
                      padding: const EdgeInsets.symmetric(horizontal: 22),
                      textStyle: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _Arrow extends StatelessWidget {
  final bool left;
  final VoidCallback? onPressed;

  const _Arrow({required this.left, this.onPressed});

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: left ? Alignment.centerLeft : Alignment.centerRight,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4),
        child: IconButton(
          onPressed: onPressed,
          tooltip: left ? 'Previous' : 'Next',
          icon: Icon(left ? Icons.chevron_left : Icons.chevron_right),
          iconSize: 30,
          style: IconButton.styleFrom(
            foregroundColor: Colors.white,
            backgroundColor: Colors.black.withValues(alpha: 0.45),
            disabledForegroundColor: Colors.white24,
            shape: const CircleBorder(),
          ),
        ),
      ),
    );
  }
}
