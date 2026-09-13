import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// One entry in the toast stack — see watch_party_overlay.dart for when these are pushed (a new
/// participant joining, or this session's own control being granted/revoked).
class WatchPartyToastData {
  final int id;
  final String message;
  final bool control; // true = "granted"/"revoked" (ember accent, shown a beat longer)
  const WatchPartyToastData({required this.id, required this.message, this.control = false});
}

/// Top-corner, auto-dismissing, never over playback controls, never steals focus — see
/// design.html's "Joins & control changes" notification pattern.
class WatchPartyToastStack extends StatelessWidget {
  final List<WatchPartyToastData> toasts;
  const WatchPartyToastStack({super.key, required this.toasts});

  @override
  Widget build(BuildContext context) {
    if (toasts.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      mainAxisSize: MainAxisSize.min,
      children: toasts
          .map(
            (toast) => Container(
              margin: const EdgeInsets.only(bottom: 6),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
              constraints: const BoxConstraints(maxWidth: 240),
              decoration: BoxDecoration(
                color: AppColors.surfaceHover.withValues(alpha: 0.95),
                borderRadius: BorderRadius.circular(10),
                border: Border(
                  top: const BorderSide(color: AppColors.dividerStrong),
                  right: const BorderSide(color: AppColors.dividerStrong),
                  bottom: const BorderSide(color: AppColors.dividerStrong),
                  left: BorderSide(color: toast.control ? AppColors.accent : AppColors.textTertiary, width: 3),
                ),
              ),
              child: Text(toast.message, style: const TextStyle(color: Colors.white, fontSize: 12)),
            ),
          )
          .toList(),
    );
  }
}
