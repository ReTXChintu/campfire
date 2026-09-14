import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import 'tv_focusable.dart';

// The primary TV interaction (typed chat is secondary there); offered everywhere for consistency.
// Mirrors apps/frontend/src/routes/WatchPage.tsx's REACTION_EMOJIS.
const kReactionEmojis = ['😂', '🔥', '👏', '❤️', '👍'];

/// A row of quick-reaction buttons — see design.html. On TV each button is a [TvFocusable] so it's
/// reachable D-pad-only; elsewhere a plain tap target.
class ReactionPicker extends StatelessWidget {
  final ValueChanged<String> onSend;
  final bool tvFocusable;

  const ReactionPicker({super.key, required this.onSend, this.tvFocusable = false});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        for (final emoji in kReactionEmojis)
          Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 3),
              child: tvFocusable
                  ? TvFocusable(onTap: () => onSend(emoji), child: _EmojiButton(emoji: emoji))
                  : GestureDetector(onTap: () => onSend(emoji), child: _EmojiButton(emoji: emoji)),
            ),
          ),
      ],
    );
  }
}

class _EmojiButton extends StatelessWidget {
  final String emoji;
  const _EmojiButton({required this.emoji});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.dividerStrong),
        borderRadius: BorderRadius.circular(10),
        color: AppColors.surfaceHover,
      ),
      child: Text(emoji, style: const TextStyle(fontSize: 20)),
    );
  }
}
