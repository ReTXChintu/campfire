import '../models/tracks.dart';

/// What the player should do about the backend's `startAudio` / `startSubtitle`, given what mpv
/// has reported so far. Kept free of media_kit types so it can be tested on its own; the player
/// maps the ids back to its `AudioTrack` / `SubtitleTrack` objects.
class StartTrackPlan {
  /// The file's tracks aren't known yet: ask again on the next track-list update.
  final bool audioPending;

  /// mpv aid to switch to; null leaves audio as it is.
  final String? audioId;

  final bool subtitlePending;

  /// What to show; null leaves subtitles as they are. An embedded one carries mpv's sid as [StartSubtitle.n].
  final StartSubtitle? subtitle;

  const StartTrackPlan({
    this.audioPending = false,
    this.audioId,
    this.subtitlePending = false,
    this.subtitle,
  });
}

/// Resolves the start tracks against mpv's track list.
///
/// [audioIds] / [subtitleIds] are mpv's real track ids (without "auto"/"no"); [tracksKnown] is
/// whether mpv has reported this file's track list at all — it arrives in one go once the file
/// is open, so a track missing from a known list will never turn up, while an empty list before
/// then just means "not yet". [externalCount] is the length of the response's `subtitles`.
///
/// A start the file can't honour (a track number it doesn't have, an upload index out of range)
/// resolves to "leave as is" rather than waiting forever.
StartTrackPlan planStartTracks({
  required int? startAudio,
  required StartSubtitle? startSubtitle,
  required List<String> audioIds,
  required List<String> subtitleIds,
  required bool tracksKnown,
  required int externalCount,
}) {
  var audioPending = false;
  String? audioId;
  if (startAudio != null) {
    if (!tracksKnown) {
      audioPending = true;
    } else if (audioIds.contains('$startAudio')) {
      audioId = '$startAudio';
    }
  }

  var subtitlePending = false;
  StartSubtitle? subtitle;
  final s = startSubtitle;
  if (s != null) {
    if (s.isOff) {
      subtitle = s;
    } else if (s.isExternal) {
      final index = s.index!;
      if (index >= 0 && index < externalCount) subtitle = s;
    } else if (s.isEmbedded) {
      if (!tracksKnown) {
        subtitlePending = true;
      } else if (subtitleIds.contains('${s.n}')) {
        subtitle = s;
      }
    }
  }

  return StartTrackPlan(
    audioPending: audioPending,
    audioId: audioId,
    subtitlePending: subtitlePending,
    subtitle: subtitle,
  );
}
