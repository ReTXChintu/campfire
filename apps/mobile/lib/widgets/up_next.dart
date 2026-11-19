import 'package:flutter/material.dart';
import '../models/catalog.dart';
import '../theme/app_theme.dart';
import 'authed_network_image.dart';
import 'tv_focusable.dart';

/// How many titles in a row have started on their own, with nobody touching the player in
/// between. It lives outside any one player because each title opens a fresh one. After
/// [upNextStreakLimit] of them, the next title waits for a "Still watching?" instead of starting
/// — nobody wants a series to play to an empty room all night.
int upNextAutoplayStreak = 0;
const upNextStreakLimit = 2;

/// SharedPreferences key for the viewer's autoplay switch (default on).
const upNextAutoplayPrefKey = 'player_autoplay_next';

/// Seconds the card counts down before an episode starts; a suggested title (a different film or
/// series entirely) gets a little longer to be turned down.
int upNextCountdownSeconds(UpNextItem item) => item.isEpisode ? 10 : 15;

/// The card in the corner near the end: the next episode, or after a film or a finale the
/// library's best match. With a countdown it fills its Play button and starts on its own.
class UpNextCard extends StatelessWidget {
  final UpNextItem item;

  /// Seconds still to go, or null when nothing is counting down (autoplay off, a "still
  /// watching?" pause, or a party that the host moves on).
  final double? secondsLeft;
  final int totalSeconds;

  /// True once [upNextStreakLimit] titles have started on their own: the card says why it isn't
  /// counting down.
  final bool askStillWatching;
  final bool autoplay;
  final ValueChanged<bool>? onAutoplayChanged;
  final VoidCallback onPlay;
  final VoidCallback onDismiss;
  final bool compact;

  const UpNextCard({
    super.key,
    required this.item,
    required this.secondsLeft,
    required this.totalSeconds,
    required this.askStillWatching,
    required this.autoplay,
    required this.onAutoplayChanged,
    required this.onPlay,
    required this.onDismiss,
    this.compact = false,
  });

  @override
  Widget build(BuildContext context) {
    final left = secondsLeft;
    final label = item.isEpisode ? 'Up next' : 'Recommended for you';
    final status = left != null
        ? '$label · in ${left.ceil()}s'
        : askStillWatching
            ? 'Still watching?'
            : label;
    return Material(
      color: const Color(0xF2161412),
      elevation: 8,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadius.md),
        side: const BorderSide(color: AppColors.dividerStrong),
      ),
      clipBehavior: Clip.antiAlias,
      child: SizedBox(
        width: compact ? 280 : 360,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                    child: SizedBox(
                      width: compact ? 96 : 128,
                      child: AspectRatio(aspectRatio: 16 / 9, child: AuthedNetworkImage(path: item.imagePath)),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          status.toUpperCase(),
                          style: const TextStyle(
                            color: AppColors.accent,
                            fontSize: 10.5,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 0.8,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          item.title,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w700, height: 1.2),
                        ),
                        if (item.subtitle != null) ...[
                          const SizedBox(height: 3),
                          Text(
                            item.subtitle!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                          ),
                        ],
                      ],
                    ),
                  ),
                  _closeButton(),
                ],
              ),
              if (askStillWatching) ...[
                const SizedBox(height: 10),
                const Text(
                  'Two played in a row on their own, so this one waits for you.',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 12, height: 1.3),
                ),
              ],
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(child: _playButton(left)),
                  if (onAutoplayChanged != null) ...[
                    const SizedBox(width: 12),
                    _autoplaySwitch(),
                  ],
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _closeButton() {
    return TvFocusable(
      onTap: onDismiss,
      borderRadius: BorderRadius.circular(AppRadius.pill),
      child: Tooltip(
        message: 'Not now',
        child: Semantics(
          button: true,
          label: 'Hide up next',
          excludeSemantics: true,
          child: const Padding(
            padding: EdgeInsets.all(4),
            child: Icon(Icons.close, size: 18, color: AppColors.textSecondary),
          ),
        ),
      ),
    );
  }

  /// The countdown is the button filling up, as on most streaming apps — one glance says both
  /// "this is what plays" and "how soon".
  Widget _playButton(double? left) {
    final filled = left == null ? 1.0 : (1 - left / totalSeconds).clamp(0.0, 1.0);
    final label = askStillWatching ? 'Keep watching' : (item.isEpisode ? 'Play next' : 'Play now');
    return TvFocusable(
      onTap: onPlay,
      borderRadius: BorderRadius.circular(AppRadius.pill),
      child: Semantics(
        button: true,
        label: '$label: ${item.title}',
        excludeSemantics: true,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(AppRadius.pill),
          child: SizedBox(
            height: 38,
            child: Stack(
              fit: StackFit.expand,
              children: [
                Container(color: left == null ? AppColors.accent : const Color(0x33FFFFFF)),
                if (left != null)
                  FractionallySizedBox(
                    alignment: Alignment.centerLeft,
                    widthFactor: filled,
                    child: Container(color: AppColors.accent),
                  ),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.play_arrow_rounded, color: Colors.white, size: 20),
                    const SizedBox(width: 6),
                    Text(label, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 13)),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _autoplaySwitch() {
    return Semantics(
      toggled: autoplay,
      label: 'Autoplay',
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('Autoplay', style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
          const SizedBox(width: 4),
          Transform.scale(
            scale: 0.8,
            child: Switch(
              value: autoplay,
              onChanged: onAutoplayChanged,
              activeThumbColor: Colors.white,
              activeTrackColor: AppColors.accent,
            ),
          ),
        ],
      ),
    );
  }
}

/// What the screen shows once a title has ended without moving on: the up-next choice (or a
/// "Still watching?" for it) and a row of more like this, with Watch again and Back.
class UpNextEndScreen extends StatelessWidget {
  final UpNextItem? upNext;
  final List<UpNextItem> suggestions;
  final bool askStillWatching;
  final ValueChanged<UpNextItem> onPlay;
  final VoidCallback onReplay;
  final VoidCallback onBack;
  final bool compact;

  /// The heading's face; the display font by default. (Tests pass a bundled one: the display
  /// font is fetched at run time, which a test can't do.)
  final TextStyle? headingStyle;

  const UpNextEndScreen({
    super.key,
    required this.upNext,
    required this.suggestions,
    required this.askStillWatching,
    required this.onPlay,
    required this.onReplay,
    required this.onBack,
    this.compact = false,
    this.headingStyle,
  });

  @override
  Widget build(BuildContext context) {
    final next = upNext;
    final more = [
      for (final s in suggestions)
        if (s.fileId != next?.fileId) s,
    ];
    final heading = askStillWatching
        ? 'Still watching?'
        : next != null && next.isEpisode
            ? 'Up next'
            : 'You might like';
    return ColoredBox(
      color: const Color(0xE60E0D0C),
      child: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            final cardWidth = compact ? 200.0 : (constraints.maxWidth / 5).clamp(200.0, 300.0);
            return SingleChildScrollView(
              padding: EdgeInsets.symmetric(horizontal: compact ? 16 : 32, vertical: compact ? 16 : 28),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    heading.toUpperCase(),
                    style: headingStyle ?? AppTheme.display(fontSize: compact ? 26 : 34),
                  ),
                  if (askStillWatching) ...[
                    const SizedBox(height: 6),
                    const Text(
                      'Autoplay paused after two in a row. Pick up where you are, or choose something else.',
                      style: TextStyle(color: AppColors.textSecondary, fontSize: 14),
                    ),
                  ],
                  const SizedBox(height: 16),
                  if (next != null)
                    _UpNextTile(item: next, width: cardWidth * 1.4, prominent: true, onTap: () => onPlay(next)),
                  if (more.isNotEmpty) ...[
                    const SizedBox(height: 22),
                    const Text(
                      'MORE LIKE THIS',
                      style: TextStyle(color: AppColors.textSecondary, fontSize: 12, fontWeight: FontWeight.w800, letterSpacing: 0.8),
                    ),
                    const SizedBox(height: 10),
                    SizedBox(
                      height: cardWidth * 9 / 16 + 60,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: more.length,
                        separatorBuilder: (_, _) => const SizedBox(width: 12),
                        itemBuilder: (context, i) => _UpNextTile(item: more[i], width: cardWidth, onTap: () => onPlay(more[i])),
                      ),
                    ),
                  ],
                  const SizedBox(height: 22),
                  Wrap(
                    spacing: 12,
                    runSpacing: 12,
                    children: [
                      _EndButton(icon: Icons.replay, label: 'Watch again', onTap: onReplay),
                      _EndButton(icon: Icons.arrow_back, label: 'Back', onTap: onBack),
                    ],
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

class _UpNextTile extends StatelessWidget {
  final UpNextItem item;
  final double width;
  final bool prominent;
  final VoidCallback onTap;

  const _UpNextTile({required this.item, required this.width, required this.onTap, this.prominent = false});

  @override
  Widget build(BuildContext context) {
    return TvFocusable(
      autofocus: prominent,
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: Semantics(
        button: true,
        label: 'Play ${item.title}',
        excludeSemantics: true,
        child: SizedBox(
          width: width,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(AppRadius.md),
                child: AspectRatio(
                  aspectRatio: 16 / 9,
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      AuthedNetworkImage(path: item.imagePath),
                      const Center(
                        child: DecoratedBox(
                          decoration: BoxDecoration(color: Color(0x99000000), shape: BoxShape.circle),
                          child: Padding(
                            padding: EdgeInsets.all(8),
                            child: Icon(Icons.play_arrow_rounded, color: Colors.white, size: 28),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Text(
                item.title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: prominent ? 16 : 13),
              ),
              if (item.subtitle != null)
                Text(
                  item.subtitle!,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                ),
              if (prominent && item.overview != null) ...[
                const SizedBox(height: 4),
                Text(
                  item.overview!,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 12, height: 1.35),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _EndButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _EndButton({required this.icon, required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return TvFocusable(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppRadius.pill),
      child: Semantics(
        button: true,
        label: label,
        excludeSemantics: true,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppRadius.pill),
            border: Border.all(color: AppColors.dividerStrong),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, color: Colors.white, size: 18),
              const SizedBox(width: 8),
              Text(label, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 13)),
            ],
          ),
        ),
      ),
    );
  }
}
