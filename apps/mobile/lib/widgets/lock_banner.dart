import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Explains the "locked" (no playback control) watch-party state in the chrome itself, instead of
/// just silently greying out the seek/skip/speed buttons — see design.html's lock-banner component.
/// Shown by MediaKitVideoPlayer whenever `_locked` is true.
///
/// Doesn't know *who* currently holds control by name — the watch-party roster only carries a
/// device label (see models/watch_party.dart's WatchPartyParticipant), not the account's display
/// name, so this stays deliberately generic rather than fabricating one.
class LockBanner extends StatelessWidget {
  const LockBanner({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      decoration: BoxDecoration(
        color: AppColors.surfaceHover.withValues(alpha: 0.92),
        borderRadius: BorderRadius.circular(10),
        border: Border(
          top: const BorderSide(color: AppColors.dividerStrong),
          right: const BorderSide(color: AppColors.dividerStrong),
          bottom: const BorderSide(color: AppColors.dividerStrong),
          left: const BorderSide(color: AppColors.danger, width: 3),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.lock_outline, color: AppColors.danger, size: 18),
          const SizedBox(width: 10),
          Flexible(
            child: RichText(
              text: const TextSpan(
                style: TextStyle(fontSize: 12.5, height: 1.35, color: Colors.white),
                children: [
                  TextSpan(text: 'Someone else has the remote\n', style: TextStyle(fontWeight: FontWeight.w700)),
                  TextSpan(
                    text: 'You can watch, chat, and talk — ask them to hand it over.',
                    style: TextStyle(color: AppColors.textSecondary),
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
