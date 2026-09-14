import 'package:flutter/material.dart';

class FloatingReactionData {
  final int id;
  final String emoji;
  final double x; // 0.0-1.0 fraction of the overlay's width
  const FloatingReactionData({required this.id, required this.emoji, required this.x});
}

/// Floats a quick reaction up over the video for a couple seconds, then it's gone — ephemeral, no
/// persistence (the caller, WatchPartyOverlay, removes each entry from the list on its own timer,
/// matching the animation's own duration). Mirrors
/// apps/frontend/src/components/ReactionOverlay.tsx.
class ReactionOverlay extends StatelessWidget {
  final List<FloatingReactionData> reactions;
  const ReactionOverlay({super.key, required this.reactions});

  @override
  Widget build(BuildContext context) {
    if (reactions.isEmpty) return const SizedBox.shrink();
    return IgnorePointer(
      child: LayoutBuilder(
        builder: (context, constraints) {
          return Stack(
            children: [
              for (final reaction in reactions)
                Positioned(
                  left: constraints.maxWidth * reaction.x,
                  bottom: 80,
                  child: _FloatingEmoji(key: ValueKey(reaction.id), emoji: reaction.emoji),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _FloatingEmoji extends StatefulWidget {
  final String emoji;
  const _FloatingEmoji({super.key, required this.emoji});

  @override
  State<_FloatingEmoji> createState() => _FloatingEmojiState();
}

class _FloatingEmojiState extends State<_FloatingEmoji> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2200),
  )..forward();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final t = _controller.value;
        // First 15% pops in, the rest rises and fades — mirrors index.css's reaction-float keyframe.
        final riseT = t < 0.15 ? 0.0 : (t - 0.15) / 0.85;
        final opacity = t < 0.15 ? t / 0.15 : (1 - riseT).clamp(0.0, 1.0);
        return Opacity(
          opacity: opacity,
          child: Transform.translate(
            offset: Offset(0, -160 * riseT),
            child: Transform.scale(
              scale: t < 0.15 ? 0.6 + 0.4 * (t / 0.15) : 1.0 + 0.1 * riseT,
              child: Text(widget.emoji, style: const TextStyle(fontSize: 36)),
            ),
          ),
        );
      },
    );
  }
}
