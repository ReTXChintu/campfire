/// Minimal WebVTT cue parser — video_player has no built-in text-track rendering (unlike an HTML
/// `<track>` element, which is what the web app relies on), so subtitles are parsed once here and
/// the active cue is picked by comparing its start/end against the current playback position (see
/// widgets/campfire_video_player.dart). Handles the plain `mm:ss.mmm`/`hh:mm:ss.mmm` cues ffmpeg
/// produces (see apps/backend's lib/drive.ts) — not the full VTT spec (no styling, positioning, or
/// NOTE/STYLE/REGION blocks beyond skipping them).
class VttCue {
  final Duration start;
  final Duration end;
  final String text;
  const VttCue({required this.start, required this.end, required this.text});
}

List<VttCue> parseVtt(String vtt) {
  final lines = vtt.replaceAll('\r\n', '\n').split('\n');
  final cues = <VttCue>[];

  int i = 0;
  while (i < lines.length) {
    final line = lines[i].trim();
    if (line.contains('-->')) {
      final parts = line.split('-->');
      final start = _parseTimestamp(parts[0].trim());
      final end = _parseTimestamp(parts[1].trim().split(' ').first);
      i++;
      final textLines = <String>[];
      while (i < lines.length && lines[i].trim().isNotEmpty) {
        textLines.add(lines[i]);
        i++;
      }
      if (start != null && end != null && textLines.isNotEmpty) {
        cues.add(VttCue(start: start, end: end, text: textLines.join('\n')));
      }
    } else {
      i++;
    }
  }
  return cues;
}

Duration? _parseTimestamp(String raw) {
  final match = RegExp(r'^(\d+):(\d{2})(?::(\d{2}))?\.(\d{3})$').firstMatch(raw);
  if (match == null) return null;
  final a = int.parse(match.group(1)!);
  final b = int.parse(match.group(2)!);
  final c = match.group(3);
  final ms = int.parse(match.group(4)!);

  if (c != null) {
    // hh:mm:ss.mmm
    return Duration(hours: a, minutes: b, seconds: int.parse(c), milliseconds: ms);
  }
  // mm:ss.mmm
  return Duration(minutes: a, seconds: b, milliseconds: ms);
}

String? activeCueText(List<VttCue> cues, Duration position) {
  for (final cue in cues) {
    if (position >= cue.start && position <= cue.end) return cue.text;
  }
  return null;
}
