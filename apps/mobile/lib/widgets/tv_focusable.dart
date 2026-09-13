import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Wraps a card/tile so it participates in D-pad focus traversal — a bare GestureDetector (what
/// VideoCard/FolderCard used before this) has no Focus node of its own, so it's invisible to
/// Android TV remote navigation and reachable only by touch or a mouse pointer. This adds a focus
/// node, a visible highlight (border + slight scale, since these cards sit over poster art where a
/// subtle default focus tint wouldn't read as clearly as it does on a plain button), and wires
/// Enter/Space/D-pad-center ("select") to the same [onTap] a pointer tap already uses.
class TvFocusable extends StatefulWidget {
  final Widget child;
  final VoidCallback onTap;
  final bool autofocus;
  final BorderRadius borderRadius;

  const TvFocusable({
    super.key,
    required this.child,
    required this.onTap,
    this.autofocus = false,
    this.borderRadius = const BorderRadius.all(Radius.circular(8)),
  });

  @override
  State<TvFocusable> createState() => _TvFocusableState();
}

class _TvFocusableState extends State<TvFocusable> {
  bool _focused = false;

  @override
  Widget build(BuildContext context) {
    return FocusableActionDetector(
      autofocus: widget.autofocus,
      mouseCursor: SystemMouseCursors.click,
      onShowFocusHighlight: (value) {
        if (mounted) setState(() => _focused = value);
      },
      actions: {
        ActivateIntent: CallbackAction<ActivateIntent>(
          onInvoke: (_) {
            widget.onTap();
            return null;
          },
        ),
      },
      child: GestureDetector(
        onTap: widget.onTap,
        child: AnimatedScale(
          scale: _focused ? 1.06 : 1.0,
          duration: const Duration(milliseconds: 120),
          curve: Curves.easeOut,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 120),
            decoration: BoxDecoration(
              borderRadius: widget.borderRadius,
              // Gold, not the Ember accent — design.html reserves Gold for exactly one job (the TV
              // focus ring) so a focused element is never visually confused with an accented/"live"
              // one.
              border: Border.all(color: _focused ? AppColors.amber : Colors.transparent, width: 3),
            ),
            child: widget.child,
          ),
        ),
      ),
    );
  }
}
