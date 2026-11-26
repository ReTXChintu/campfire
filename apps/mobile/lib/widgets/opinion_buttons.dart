import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/opinion_store.dart';
import '../theme/app_theme.dart';

/// Watched it, liked it, didn't: for a film or a whole series, whether or not it's in the library
/// (web apps/frontend/src/components/OpinionButtons.tsx). What's set here shapes Home's For you
/// rows. Nothing for an episode or a title TMDb doesn't have — pass a null [type]/[id].
class OpinionButtons extends StatefulWidget {
  final String? type; // "movie" | "tv"
  final String? id;

  const OpinionButtons({super.key, required this.type, required this.id});

  @override
  State<OpinionButtons> createState() => _OpinionButtonsState();
}

class _OpinionButtonsState extends State<OpinionButtons> {
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<OpinionStore>().ensureLoaded();
    });
  }

  Future<void> _save(Future<void> Function() change) async {
    setState(() => _failed = false);
    try {
      await change();
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final type = widget.type;
    final id = widget.id;
    if (type == null || id == null) return const SizedBox.shrink();
    final store = context.watch<OpinionStore>();
    final opinion = store.opinionOf(type, id);
    final watched = opinion?.watched ?? false;
    final rating = opinion?.rating;

    void rate(Rating value) => _save(() => rating == value
        ? store.set(type, id, clearRating: true)
        : store.set(type, id, rating: value));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            _Toggle(
              label: 'Watched',
              icon: Icons.check,
              on: watched,
              tone: AppColors.live,
              onTap: () => _save(() => store.set(type, id, watched: !watched)),
            ),
            _Toggle(
              label: 'Like',
              icon: rating == Rating.like ? Icons.thumb_up : Icons.thumb_up_outlined,
              on: rating == Rating.like,
              tone: AppColors.amber,
              onTap: () => rate(Rating.like),
            ),
            _Toggle(
              label: 'Dislike',
              icon: rating == Rating.dislike ? Icons.thumb_down : Icons.thumb_down_outlined,
              on: rating == Rating.dislike,
              tone: AppColors.danger,
              onTap: () => rate(Rating.dislike),
            ),
          ],
        ),
        if (_failed)
          const Padding(
            padding: EdgeInsets.only(top: 8),
            child: Text("That wasn't saved. Try again.", style: TextStyle(color: AppColors.danger, fontSize: 13)),
          ),
      ],
    );
  }
}

class _Toggle extends StatelessWidget {
  final String label;
  final IconData icon;
  final bool on;
  final Color tone;
  final VoidCallback onTap;

  const _Toggle({required this.label, required this.icon, required this.on, required this.tone, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      toggled: on,
      button: true,
      child: OutlinedButton.icon(
        onPressed: onTap,
        icon: Icon(icon, size: 16),
        label: Text(label),
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(0, 44),
          padding: const EdgeInsets.symmetric(horizontal: 14),
          foregroundColor: on ? tone : AppColors.foreground,
          backgroundColor: on ? tone.withValues(alpha: 0.15) : Colors.transparent,
          side: BorderSide(color: on ? tone : AppColors.dividerStrong),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.sm)),
          textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
        ),
      ),
    );
  }
}
