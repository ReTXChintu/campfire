import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../models/catalog.dart';
import '../platform_info.dart';
import '../theme/app_theme.dart';
import 'authed_network_image.dart';

/// The Home spotlight — up to 6 slides from `GET /api/library`'s `spotlight` array, replacing the
/// single HeroBanner the screen used to show. Slide anatomy is unchanged from that hero; what's
/// new is that there's more than one of them.
///
/// Three surfaces, one widget: a phone swipes it, Windows and Android TV reach the prev/next
/// buttons with a D-pad or the arrow keys (the buttons are real focus targets, so traversal finds
/// them — see tv_focusable.dart for the same reasoning applied to cards). Auto-advance runs every
/// 7s, stops the moment anyone touches, drags or focuses the carousel, and never runs at all when
/// the platform asks for reduced motion (`MediaQuery.disableAnimations`).
class SpotlightCarousel extends StatefulWidget {
  final List<SpotlightSlide> slides;

  const SpotlightCarousel({super.key, required this.slides});

  @override
  State<SpotlightCarousel> createState() => _SpotlightCarouselState();
}

class _SpotlightCarouselState extends State<SpotlightCarousel> {
  static const _advanceEvery = Duration(seconds: 7);
  // How long a touch/drag/keypress keeps auto-advance out of the way before it resumes. Long
  // enough that it never yanks the slide out from under someone still reading it.
  static const _resumeAfter = Duration(seconds: 20);

  final _controller = PageController();
  final _focusNode = FocusNode(debugLabel: 'SpotlightCarousel');
  Timer? _advanceTimer;
  Timer? _resumeTimer;
  int _index = 0;
  bool _hovered = false;

  /// The Play button on slide 1 autofocuses (TV needs an initial D-pad target), and that is not
  /// the viewer taking control — so the first focus-gain is ignored and every later focus move,
  /// which *is* a D-pad press, counts as an interaction.
  bool _sawInitialFocus = false;
  bool _reducedMotion = false;

  @override
  void initState() {
    super.initState();
    // The first timer can't start here — MediaQuery isn't readable from initState.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _syncAutoAdvance();
    });
  }

  @override
  void didUpdateWidget(SpotlightCarousel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.slides.length != oldWidget.slides.length) {
      if (_index >= widget.slides.length) {
        _index = 0;
        if (_controller.hasClients) _controller.jumpToPage(0);
      }
      _syncAutoAdvance();
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduced = MediaQuery.disableAnimationsOf(context);
    if (reduced != _reducedMotion) {
      _reducedMotion = reduced;
      _syncAutoAdvance();
    }
  }

  @override
  void dispose() {
    _advanceTimer?.cancel();
    _resumeTimer?.cancel();
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  bool get _shouldAutoAdvance =>
      widget.slides.length > 1 && !_reducedMotion && !_hovered && _resumeTimer == null;

  void _syncAutoAdvance() {
    _advanceTimer?.cancel();
    _advanceTimer = _shouldAutoAdvance ? Timer.periodic(_advanceEvery, (_) => _advance()) : null;
  }

  /// Any deliberate interaction — a tap, a drag, an arrow key, the prev/next buttons — parks
  /// auto-advance for [_resumeAfter] rather than fighting the person using it.
  void _noteInteraction() {
    _resumeTimer?.cancel();
    _resumeTimer = Timer(_resumeAfter, () {
      _resumeTimer = null;
      if (mounted) _syncAutoAdvance();
    });
    _syncAutoAdvance();
  }

  void _advance() {
    if (!_controller.hasClients || widget.slides.length < 2) return;
    _goTo((_index + 1) % widget.slides.length, animate: !_reducedMotion);
  }

  void _goTo(int index, {bool animate = true}) {
    if (!_controller.hasClients) return;
    final target = index.clamp(0, widget.slides.length - 1);
    if (animate) {
      _controller.animateToPage(
        target,
        duration: const Duration(milliseconds: 320),
        curve: Curves.easeOutCubic,
      );
    } else {
      _controller.jumpToPage(target);
    }
  }

  void _step(int delta) {
    _noteInteraction();
    final next = _index + delta;
    if (next < 0 || next >= widget.slides.length) return;
    _goTo(next);
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent || widget.slides.length < 2) return KeyEventResult.ignored;
    if (event.logicalKey == LogicalKeyboardKey.arrowRight) {
      _step(1);
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.arrowLeft) {
      _step(-1);
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    if (widget.slides.isEmpty) return const SizedBox.shrink();

    // Only the surfaces with a pointer-less or mouse-driven pager get chevrons; a phone swipes.
    final showArrows = widget.slides.length > 1 && (isDesktopAdminCapable || isAndroidTv);

    return Focus(
      focusNode: _focusNode,
      skipTraversal: true,
      canRequestFocus: false,
      onKeyEvent: _onKey,
      onFocusChange: (focused) {
        if (focused && !_sawInitialFocus) {
          _sawInitialFocus = true;
          return;
        }
        _noteInteraction();
      },
      child: Semantics(
        container: true,
        label: 'Spotlight, ${widget.slides.length} ${widget.slides.length == 1 ? "title" : "titles"}',
        child: MouseRegion(
          // Desktop/mouse: hovering the spotlight holds it still for as long as the pointer is
          // over it, rather than sliding out from under the cursor.
          onEnter: (_) {
            _hovered = true;
            _syncAutoAdvance();
          },
          onExit: (_) {
            _hovered = false;
            _syncAutoAdvance();
          },
          child: SizedBox(
            height: 340,
            child: Stack(
              children: [
                Listener(
                  onPointerDown: (_) => _noteInteraction(),
                  child: PageView.builder(
                    controller: _controller,
                    itemCount: widget.slides.length,
                    onPageChanged: (index) => setState(() => _index = index),
                    itemBuilder: (context, index) => SpotlightSlideView(
                      slide: widget.slides[index],
                      // One initial D-pad target for the whole Home screen, same job the old hero's
                      // autofocused Play button did.
                      autofocusPlay: index == 0,
                    ),
                  ),
                ),
                if (showArrows) ...[
                  _Chevron(
                    alignment: Alignment.centerLeft,
                    icon: Icons.chevron_left,
                    tooltip: 'Previous',
                    onPressed: _index > 0 ? () => _step(-1) : null,
                  ),
                  _Chevron(
                    alignment: Alignment.centerRight,
                    icon: Icons.chevron_right,
                    tooltip: 'Next',
                    onPressed: _index < widget.slides.length - 1 ? () => _step(1) : null,
                  ),
                ],
                if (widget.slides.length > 1)
                  Positioned(
                    left: 0,
                    right: 0,
                    bottom: 8,
                    child: _Dots(
                      count: widget.slides.length,
                      index: _index,
                      onTap: (i) {
                        _noteInteraction();
                        _goTo(i);
                      },
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

/// A single spotlight slide. Kept public so the widget can be reused (and read) on its own; the
/// layout is the former HeroBanner's, plus the request slide's secondary board link.
class SpotlightSlideView extends StatelessWidget {
  final SpotlightSlide slide;
  final bool autofocusPlay;

  const SpotlightSlideView({super.key, required this.slide, this.autofocusPlay = false});

  @override
  Widget build(BuildContext context) {
    final thumbnailPath = slide.thumbnailPath;

    return Container(
      width: double.infinity,
      color: AppColors.background,
      child: Stack(
        children: [
          if (thumbnailPath != null)
            Positioned.fill(
              child: AuthedNetworkImage(path: thumbnailPath, fit: BoxFit.cover),
            ),
          // Darkens the backdrop enough to keep the title/buttons legible; falls back to the
          // brand-colored radial gradient when there's no image to darken.
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: thumbnailPath != null
                    ? LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [
                          Colors.black.withValues(alpha: 0.35),
                          Colors.black.withValues(alpha: 0.15),
                          AppColors.background,
                        ],
                        stops: const [0, 0.5, 1],
                      )
                    : const RadialGradient(
                        center: Alignment(0.4, -0.6),
                        radius: 1.2,
                        colors: [Color(0xFF3A1A12), Color(0xFF1A0E12), AppColors.background],
                        stops: [0, 0.4, 0.9],
                      ),
              ),
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            height: 140,
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.bottomCenter,
                  end: Alignment.topCenter,
                  colors: [AppColors.background, AppColors.background.withValues(alpha: 0)],
                ),
              ),
            ),
          ),
          Positioned(
            left: 16,
            right: 16,
            bottom: 32,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                if (slide.badge.isNotEmpty) _SlideBadge(text: slide.badge, request: slide.isRequest),
                Text(
                  slide.title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: AppTheme.display(fontSize: 44),
                ),
                const SizedBox(height: 16),
                Wrap(
                  spacing: 10,
                  runSpacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    ElevatedButton.icon(
                      autofocus: autofocusPlay,
                      onPressed: () => context.push(slide.playHref),
                      icon: const Icon(Icons.play_arrow, size: 20),
                      label: const Text('Play'),
                    ),
                    if (slide.infoHref != null)
                      OutlinedButton(
                        onPressed: () => context.push(slide.infoHref!),
                        style: _ghostButtonStyle,
                        child: const Text('More Info'),
                      ),
                    // A fulfilled request keeps a way back to the ask it came from, so "you asked
                    // for this" is checkable rather than just flattering.
                    if (slide.isRequest && slide.requestId != null)
                      OutlinedButton.icon(
                        onPressed: () => context.push('/requests?request=${slide.requestId}'),
                        style: _ghostButtonStyle,
                        icon: const Icon(Icons.auto_awesome, size: 18),
                        label: Text(slide.youAsked ? 'Your request' : 'See the request'),
                      ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  static final _ghostButtonStyle = OutlinedButton.styleFrom(
    foregroundColor: Colors.white,
    backgroundColor: Colors.white.withValues(alpha: 0.1),
    side: BorderSide(color: Colors.white.withValues(alpha: 0.15)),
  );
}

class _SlideBadge extends StatelessWidget {
  final String text;
  final bool request;

  const _SlideBadge({required this.text, required this.request});

  @override
  Widget build(BuildContext context) {
    // Ember for a request slide, Gold for a library pick — the badge says which kind of slide this
    // is before the wording does.
    final color = request ? AppColors.accent : AppColors.amber;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        border: Border.all(color: color.withValues(alpha: 0.35)),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(text.toUpperCase(), style: TextStyle(color: color, fontSize: 11, letterSpacing: 1)),
    );
  }
}

class _Chevron extends StatelessWidget {
  final Alignment alignment;
  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;

  const _Chevron({required this.alignment, required this.icon, required this.tooltip, this.onPressed});

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: alignment,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4),
        child: IconButton(
          onPressed: onPressed,
          tooltip: tooltip,
          icon: Icon(icon),
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

class _Dots extends StatelessWidget {
  final int count;
  final int index;
  final ValueChanged<int> onTap;

  const _Dots({required this.count, required this.index, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: List.generate(count, (i) {
        final active = i == index;
        return Semantics(
          button: true,
          selected: active,
          label: 'Slide ${i + 1} of $count',
          child: InkWell(
            onTap: () => onTap(i),
            customBorder: const StadiumBorder(),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                width: active ? 22 : 8,
                height: 8,
                decoration: BoxDecoration(
                  color: active ? AppColors.accent : Colors.white.withValues(alpha: 0.35),
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
            ),
          ),
        );
      }),
    );
  }
}
