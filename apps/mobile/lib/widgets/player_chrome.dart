import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

String formatPlayerTime(Duration d) {
  if (d.isNegative) d = Duration.zero;
  final h = d.inHours;
  final m = d.inMinutes.remainder(60);
  final s = d.inSeconds.remainder(60);
  final mm = h > 0 ? m.toString().padLeft(2, '0') : m.toString();
  final ss = s.toString().padLeft(2, '0');
  return h > 0 ? '$h:$mm:$ss' : '$mm:$ss';
}

/// The watch-party entry in the player's top bar.
class PlayerPartyChip {
  final int members;
  final int unread;
  final bool locked;
  final VoidCallback onTap;
  const PlayerPartyChip({required this.members, required this.unread, required this.locked, required this.onTap});
}

/// The player's controls, exactly as the approved phone design, as a plain widget of values and
/// callbacks — MediaKitVideoPlayer owns the state, this owns the layout. Kept separate so it can
/// be rendered and looked at in tests (test/player_chrome_test.dart) without a native player.
///
/// Top: back · title (+ meta line) · watch party. Centre: −10 · play/pause · +10. Bottom: scrub bar
/// (buffered range, intro/outro ticks), elapsed and −remaining, then in landscape the subtitle,
/// audio, speed and episode labels with next/PiP/full screen at the end; upright only next and
/// full screen (the rest lives under the video in that layout).
class PlayerChrome extends StatelessWidget {
  final bool visible;
  final bool landscape;
  final String title;
  final String? metaLine;
  final bool playing;
  final bool locked;
  final Duration position;
  final Duration buffered;
  final Duration duration;
  final double? scrubSeconds;
  final List<double> ticks;

  /// Null when the title has no subtitles at all (the button is hidden, not dead).
  final String? subtitleLabel;

  /// Null when there's only one audio track.
  final String? audioLabel;
  final String speedLabel;
  final bool hasEpisodes;
  final bool hasNext;
  final bool showPip;
  final bool showFullscreen;
  final bool fullscreenActive;
  final PlayerPartyChip? party;

  /// Desktop only: the player's own volume, 0–200 (above 100 is a boost, as in VLC). Null hides
  /// the control — a phone has its hardware buttons and system volume.
  final double? volume;
  final bool muted;
  final ValueChanged<double>? onVolume;
  final VoidCallback? onToggleMute;

  /// The frame at a given second, floated above the scrub bar while dragging it (and while a mouse
  /// hovers it). Null when the video has no previews: the bar shows the bare time instead.
  final Widget Function(double seconds)? scrubPreview;

  final VoidCallback onBack;
  final VoidCallback onTogglePlay;
  final VoidCallback onSkipBack;
  final VoidCallback onSkipForward;
  final ValueChanged<double> onScrubStart;
  final ValueChanged<double> onScrubUpdate;
  final ValueChanged<double> onScrubEnd;
  final VoidCallback onScrubCancel;
  final VoidCallback onLockedTap;
  final VoidCallback onSubtitles;
  final VoidCallback onAudio;
  final VoidCallback onSpeed;
  final VoidCallback onEpisodes;
  final VoidCallback onNext;
  final VoidCallback onPip;
  final VoidCallback onFullscreen;

  const PlayerChrome({
    super.key,
    required this.visible,
    required this.landscape,
    required this.title,
    required this.metaLine,
    required this.playing,
    required this.locked,
    required this.position,
    required this.buffered,
    required this.duration,
    required this.scrubSeconds,
    required this.ticks,
    required this.subtitleLabel,
    required this.audioLabel,
    required this.speedLabel,
    required this.hasEpisodes,
    required this.hasNext,
    required this.showPip,
    required this.showFullscreen,
    required this.fullscreenActive,
    required this.party,
    this.volume,
    this.muted = false,
    this.onVolume,
    this.onToggleMute,
    this.scrubPreview,
    required this.onBack,
    required this.onTogglePlay,
    required this.onSkipBack,
    required this.onSkipForward,
    required this.onScrubStart,
    required this.onScrubUpdate,
    required this.onScrubEnd,
    required this.onScrubCancel,
    required this.onLockedTap,
    required this.onSubtitles,
    required this.onAudio,
    required this.onSpeed,
    required this.onEpisodes,
    required this.onNext,
    required this.onPip,
    required this.onFullscreen,
  });

  static const _timeStyle = TextStyle(
    color: Color(0xFFE6E0D6),
    fontSize: 11,
    fontFeatures: [FontFeature.tabularFigures()],
  );

  @override
  Widget build(BuildContext context) {
    final shown = scrubSeconds != null ? Duration(milliseconds: (scrubSeconds! * 1000).round()) : position;

    return AnimatedOpacity(
      opacity: visible ? 1 : 0,
      duration: const Duration(milliseconds: 220),
      child: IgnorePointer(
        ignoring: !visible,
        child: SafeArea(
          top: landscape,
          bottom: landscape,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 4, 8, 0),
                child: Row(
                  children: [
                    PlayerIconButton(icon: Icons.arrow_back, tooltip: 'Back', onTap: onBack),
                    const SizedBox(width: 2),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w600),
                          ),
                          if (metaLine != null && landscape)
                            Text(
                              metaLine!,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
                            ),
                        ],
                      ),
                    ),
                    if (party != null) _PartyButton(chip: party!),
                  ],
                ),
              ),
              Expanded(
                child: Center(
                  // Scales down to fit the short 16:9 box of an upright phone instead of overflowing.
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Padding(
                      padding: const EdgeInsets.all(4),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          _SeekButton(forward: false, disabled: locked, onTap: onSkipBack),
                          const SizedBox(width: 26),
                          _BigPlayButton(playing: playing, disabled: locked, onTap: onTogglePlay),
                          const SizedBox(width: 26),
                          _SeekButton(forward: true, disabled: locked, onTap: onSkipForward),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              Padding(
                padding: EdgeInsets.fromLTRB(12, 0, 12, landscape ? 6 : 2),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    _ScrubBar(
                      position: shown,
                      buffered: buffered,
                      duration: duration,
                      ticks: ticks,
                      enabled: duration > Duration.zero && !locked,
                      dragging: scrubSeconds != null,
                      onChangeStart: onScrubStart,
                      onChanged: onScrubUpdate,
                      onChangeEnd: onScrubEnd,
                      onCancel: onScrubCancel,
                      onLockedTap: onLockedTap,
                      preview: scrubPreview,
                    ),
                    Row(
                      children: [
                        Text(formatPlayerTime(shown), style: _timeStyle),
                        const Spacer(),
                        Text(duration > Duration.zero ? '-${formatPlayerTime(duration - shown)}' : '--:--', style: _timeStyle),
                      ],
                    ),
                    landscape ? _landscapeRow() : _portraitRow(),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _trailing() => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (volume != null && onVolume != null && onToggleMute != null)
            PlayerVolumeControl(volume: volume!, muted: muted, onChanged: onVolume!, onToggleMute: onToggleMute!),
          if (hasNext) PlayerIconButton(icon: Icons.skip_next, tooltip: 'Next episode', onTap: onNext),
          if (showPip) PlayerIconButton(icon: Icons.picture_in_picture_alt_outlined, tooltip: 'Picture in picture', onTap: onPip),
          if (showFullscreen)
            PlayerIconButton(
              icon: fullscreenActive ? Icons.fullscreen_exit : Icons.fullscreen,
              tooltip: fullscreenActive ? 'Leave full screen' : 'Full screen',
              onTap: onFullscreen,
            ),
        ],
      );

  Widget _landscapeRow() {
    return LayoutBuilder(
      builder: (context, constraints) {
        // Narrow — the video beside a docked party panel — drops the label text, keeps the icons.
        final compact = constraints.maxWidth < 640;
        return Row(
          children: [
            Expanded(
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    if (subtitleLabel != null)
                      _LabelButton(
                        icon: Icons.closed_caption_outlined,
                        label: compact ? null : subtitleLabel,
                        tooltip: 'Subtitles: $subtitleLabel',
                        onTap: onSubtitles,
                      ),
                    if (audioLabel != null)
                      _LabelButton(
                        icon: Icons.record_voice_over_outlined,
                        label: compact ? null : audioLabel,
                        tooltip: 'Audio: $audioLabel',
                        onTap: onAudio,
                      ),
                    _LabelButton(label: speedLabel, tooltip: 'Playback speed', onTap: locked ? onLockedTap : onSpeed),
                    if (hasEpisodes)
                      _LabelButton(
                        icon: Icons.video_library_outlined,
                        label: compact ? null : 'Episodes',
                        tooltip: 'Episodes',
                        onTap: onEpisodes,
                      ),
                  ],
                ),
              ),
            ),
            _trailing(),
          ],
        );
      },
    );
  }

  Widget _portraitRow() => Row(children: [const Spacer(), _trailing()]);
}

/// Mute button plus a 0–200% slider. The stretch past 100% is drawn in amber and labelled
/// "boost": it amplifies past the file's own level (as VLC does), which a small laptop speaker
/// often needs, and can clip on an already loud mix — so it's visibly a different zone, not just
/// more of the same slider.
class PlayerVolumeControl extends StatelessWidget {
  final double volume;
  final bool muted;
  final ValueChanged<double> onChanged;
  final VoidCallback onToggleMute;

  const PlayerVolumeControl({
    super.key,
    required this.volume,
    required this.muted,
    required this.onChanged,
    required this.onToggleMute,
  });

  static const double max = 200;

  @override
  Widget build(BuildContext context) {
    final shown = muted ? 0.0 : volume.clamp(0, max).toDouble();
    final icon = shown == 0
        ? Icons.volume_off
        : shown < 50
            ? Icons.volume_down
            : Icons.volume_up;
    final boosting = shown > 100;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        PlayerIconButton(icon: icon, tooltip: muted ? 'Unmute (M)' : 'Mute (M)', onTap: onToggleMute),
        SizedBox(
          width: 120,
          child: SliderTheme(
            data: SliderTheme.of(context).copyWith(
              trackHeight: 3,
              thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 6),
              overlayShape: const RoundSliderOverlayShape(overlayRadius: 14),
              activeTrackColor: boosting ? AppColors.amber : Colors.white,
              inactiveTrackColor: Colors.white24,
              thumbColor: boosting ? AppColors.amber : Colors.white,
            ),
            child: Semantics(
              label: 'Volume',
              value: '${shown.round()} percent${boosting ? ', boosted' : ''}',
              child: Slider(
                value: shown,
                min: 0,
                max: max,
                // 5% steps from the keyboard, the same as the scroll wheel and arrow keys.
                divisions: 40,
                onChanged: onChanged,
              ),
            ),
          ),
        ),
        SizedBox(
          width: 52,
          child: Text(
            boosting ? '${shown.round()}%\nboost' : '${shown.round()}%',
            textAlign: TextAlign.left,
            style: TextStyle(
              color: boosting ? AppColors.amber : Colors.white70,
              fontSize: 11,
              height: 1.1,
              fontWeight: boosting ? FontWeight.w700 : FontWeight.w500,
            ),
          ),
        ),
      ],
    );
  }
}

class PlayerIconButton extends StatelessWidget {
  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;
  const PlayerIconButton({super.key, required this.icon, required this.tooltip, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: tooltip,
      onPressed: onTap,
      iconSize: 22,
      constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
      icon: Icon(icon, color: Colors.white),
    );
  }
}

/// In the top bar — never floating over other controls (it used to sit bottom-right, right over
/// the audio button). Member count, and a dot for unread chat.
class _PartyButton extends StatelessWidget {
  final PlayerPartyChip chip;
  const _PartyButton({required this.chip});

  @override
  Widget build(BuildContext context) {
    final inParty = chip.members > 0;
    return Semantics(
      button: true,
      label: inParty
          ? 'Watch party, ${chip.members} ${chip.members == 1 ? 'person' : 'people'}'
              '${chip.unread > 0 ? ', ${chip.unread} unread messages' : ''}'
          : 'Watch party',
      excludeSemantics: true,
      child: Material(
        color: inParty ? AppColors.accentSoft : Colors.transparent,
        shape: StadiumBorder(side: BorderSide(color: inParty ? AppColors.accent : Colors.transparent)),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: chip.onTap,
          child: Padding(
            padding: EdgeInsets.symmetric(horizontal: inParty ? 12 : 10, vertical: 9),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Stack(
                  clipBehavior: Clip.none,
                  children: [
                    Icon(chip.locked ? Icons.lock_outline : Icons.groups_outlined, color: Colors.white, size: 21),
                    if (chip.unread > 0)
                      Positioned(
                        right: -3,
                        top: -3,
                        child: Container(
                          width: 9,
                          height: 9,
                          decoration: const BoxDecoration(color: AppColors.accent, shape: BoxShape.circle),
                        ),
                      ),
                  ],
                ),
                if (inParty) ...[
                  const SizedBox(width: 7),
                  Text('${chip.members}', style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w700)),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _BigPlayButton extends StatelessWidget {
  final bool playing;
  final bool disabled;
  final VoidCallback onTap;
  const _BigPlayButton({required this.playing, required this.disabled, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: playing ? 'Pause' : 'Play',
      excludeSemantics: true,
      child: Opacity(
        opacity: disabled ? 0.45 : 1,
        child: Material(
          color: Colors.white.withValues(alpha: 0.14),
          shape: CircleBorder(side: BorderSide(color: Colors.white.withValues(alpha: 0.2))),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: onTap,
            child: SizedBox(
              width: 66,
              height: 66,
              child: Icon(playing ? Icons.pause_rounded : Icons.play_arrow_rounded, color: Colors.white, size: 36),
            ),
          ),
        ),
      ),
    );
  }
}

class _SeekButton extends StatelessWidget {
  final bool forward;
  final bool disabled;
  final VoidCallback onTap;
  const _SeekButton({required this.forward, required this.disabled, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: forward ? 'Forward 10 seconds' : 'Back 10 seconds',
      excludeSemantics: true,
      child: Opacity(
        opacity: disabled ? 0.4 : 1,
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: SizedBox(
            width: 52,
            height: 52,
            child: Icon(forward ? Icons.forward_10_rounded : Icons.replay_10_rounded, color: Colors.white, size: 30),
          ),
        ),
      ),
    );
  }
}

class _LabelButton extends StatelessWidget {
  final IconData? icon;
  final String? label;
  final String tooltip;
  final VoidCallback onTap;
  const _LabelButton({this.icon, this.label, required this.tooltip, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 42, minWidth: 42),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (icon != null) Icon(icon, color: Colors.white, size: 18),
                if (icon != null && label != null) const SizedBox(width: 5),
                if (label != null)
                  ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 110),
                    child: Text(
                      label!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600),
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

/// The accent scrub bar: buffered range behind the played range, ticks at intro/outro marks, a
/// floating time while dragging. A locked bar explains itself when touched.
class _ScrubBar extends StatefulWidget {
  final Duration position;
  final Duration buffered;
  final Duration duration;
  final List<double> ticks;
  final bool enabled;
  final bool dragging;
  final ValueChanged<double> onChangeStart;
  final ValueChanged<double> onChanged;
  final ValueChanged<double> onChangeEnd;
  final VoidCallback onCancel;
  final VoidCallback onLockedTap;
  final Widget Function(double seconds)? preview;

  const _ScrubBar({
    required this.position,
    required this.buffered,
    required this.duration,
    required this.ticks,
    required this.enabled,
    required this.dragging,
    required this.onChangeStart,
    required this.onChanged,
    required this.onChangeEnd,
    required this.onCancel,
    required this.onLockedTap,
    this.preview,
  });

  @override
  State<_ScrubBar> createState() => _ScrubBarState();
}

class _ScrubBarState extends State<_ScrubBar> {
  /// Where a mouse is resting over the bar, if one is; a touch screen never sets it.
  double? _hoverDx;

  Duration get position => widget.position;
  Duration get duration => widget.duration;
  bool get enabled => widget.enabled;
  bool get dragging => widget.dragging;

  @override
  Widget build(BuildContext context) {
    final buffered = widget.buffered;
    final ticks = widget.ticks;
    final onChangeStart = widget.onChangeStart;
    final onChanged = widget.onChanged;
    final onChangeEnd = widget.onChangeEnd;
    final onCancel = widget.onCancel;
    final onLockedTap = widget.onLockedTap;
    final total = duration.inMilliseconds / 1000;
    double frac(double seconds) => total <= 0 ? 0 : (seconds / total).clamp(0.0, 1.0);
    final played = frac(position.inMilliseconds / 1000);
    final buffer = frac(buffered.inMilliseconds / 1000);

    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        double secondsAt(double dx) => (dx / width).clamp(0.0, 1.0) * total;

        // What floats above the bar: the frame (or just the time) where a drag is, or else where
        // the mouse is.
        final hoverDx = _hoverDx;
        final floatAt = dragging ? played * width : (enabled && hoverDx != null && total > 0 ? hoverDx : null);
        final floatSeconds = floatAt == null ? null : (dragging ? position.inMilliseconds / 1000 : secondsAt(floatAt));
        final previewBuilder = widget.preview;
        const previewWidth = 180.0; // TrickplayPreview's 176 plus its border

        return Semantics(
          slider: true,
          label: 'Seek',
          value: '${formatPlayerTime(position)} of ${formatPlayerTime(duration)}',
          child: MouseRegion(
            onHover: (e) => setState(() => _hoverDx = e.localPosition.dx.clamp(0.0, width)),
            onExit: (_) => setState(() => _hoverDx = null),
            child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTapDown: (d) {
              if (!enabled) {
                onLockedTap();
                return;
              }
              onChangeStart(secondsAt(d.localPosition.dx));
            },
            onTapUp: (d) {
              if (enabled) onChangeEnd(secondsAt(d.localPosition.dx));
            },
            // A touch that turns into someone else's gesture (the brightness swipe) mustn't leave the
            // bar stuck mid-scrub.
            onTapCancel: onCancel,
            onHorizontalDragStart: enabled ? (d) => onChangeStart(secondsAt(d.localPosition.dx)) : null,
            onHorizontalDragUpdate: enabled ? (d) => onChanged(secondsAt(d.localPosition.dx)) : null,
            onHorizontalDragEnd: enabled ? (_) => onChangeEnd(position.inMilliseconds / 1000) : null,
            child: SizedBox(
              height: 30,
              child: Stack(
                clipBehavior: Clip.none,
                alignment: Alignment.centerLeft,
                children: [
                  _bar(1, Colors.white.withValues(alpha: 0.22)),
                  _bar(buffer, Colors.white.withValues(alpha: 0.36)),
                  _bar(played, AppColors.accent),
                  if (total > 0)
                    for (final t in ticks)
                      Positioned(
                        left: frac(t) * width - 1,
                        child: Container(width: 2, height: 11, color: Colors.white.withValues(alpha: 0.65)),
                      ),
                  Positioned(
                    left: played * width - (dragging ? 9 : 7),
                    child: Container(
                      width: dragging ? 18 : 14,
                      height: dragging ? 18 : 14,
                      decoration: BoxDecoration(
                        color: enabled ? AppColors.accent : AppColors.textTertiary,
                        shape: BoxShape.circle,
                        boxShadow: const [BoxShadow(color: Color(0x40FF6A3D), spreadRadius: 4)],
                      ),
                    ),
                  ),
                  if (floatAt != null && floatSeconds != null && previewBuilder != null)
                    Positioned(
                      left: (floatAt - previewWidth / 2).clamp(0.0, (width - previewWidth).clamp(0.0, double.infinity)),
                      bottom: 26,
                      child: IgnorePointer(child: previewBuilder(floatSeconds)),
                    )
                  else if (floatAt != null && floatSeconds != null)
                    Positioned(
                      left: (floatAt - 26).clamp(0.0, (width - 52).clamp(0.0, double.infinity)),
                      bottom: 26,
                      child: IgnorePointer(
                        child: Container(
                          width: 52,
                          padding: const EdgeInsets.symmetric(vertical: 4),
                          alignment: Alignment.center,
                          decoration:
                              BoxDecoration(color: Colors.black.withValues(alpha: 0.9), borderRadius: BorderRadius.circular(6)),
                          child: Text(
                            formatPlayerTime(Duration(milliseconds: (floatSeconds * 1000).round())),
                            style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w600),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
          ),
        );
      },
    );
  }

  Widget _bar(double widthFactor, Color color) => FractionallySizedBox(
        widthFactor: widthFactor,
        child: Container(height: 5, decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(3))),
      );
}
