/// Card/detail metadata derived *only* from what the API actually sends.
///
/// `GET /api/library` gives a catalog item an id, a display name and (for videos) a mimeType —
/// there is no year, runtime, genre or rating field anywhere in the backend, so the redesign's
/// card anatomy can only honestly show what the file name itself already spells out. A release
/// year and a resolution tag are near-universally present in the Drive file names this library is
/// built from (`Coldwater Pass (2019) [2160p].mkv`), and the container comes straight from the
/// mimeType — so those three are parsed here and *omitted entirely* when absent, rather than
/// guessed at. Nothing in the UI invents a value this class returns null for.
class MediaMeta {
  /// The display name with the file extension and any tokens this class lifted out of it removed.
  final String title;
  final int? year;

  /// "4K", "1080p", … from a resolution tag in the name, or null when the name has none.
  final String? quality;

  /// "MKV", "MP4", … from the mimeType — the one badge that is always truthful, and the one that
  /// matters on this app (the Windows/Android build is the only client that plays every container).
  final String? container;

  const MediaMeta({required this.title, this.year, this.quality, this.container});

  static final _extension = RegExp(r'\.[a-z0-9]{2,4}$', caseSensitive: false);
  static final _year = RegExp(r'[([.\s_-]((?:19|20)\d{2})[)\].\s_-]|[([]((?:19|20)\d{2})[)\]]$');
  static final _quality = RegExp(r'\b(2160p|4k|uhd|1440p|1080p|720p|576p|480p)\b', caseSensitive: false);
  static final _collapse = RegExp(r'\s{2,}');
  static final _trailingJunk = RegExp(r'[\s._\-([]+$');

  static const _containers = <String, String>{
    'video/x-matroska': 'MKV',
    'video/matroska': 'MKV',
    'video/mp4': 'MP4',
    'video/webm': 'WEBM',
    'video/ogg': 'OGG',
    'video/quicktime': 'MOV',
    'video/x-msvideo': 'AVI',
    'video/avi': 'AVI',
    'video/mp2t': 'TS',
    'video/x-ms-wmv': 'WMV',
    'video/x-flv': 'FLV',
  };

  /// [mimeType] is null for a folder (a series) — folders carry no container badge.
  factory MediaMeta.parse(String name, {String? mimeType}) {
    var working = name.replaceFirst(_extension, '');

    int? year;
    final yearMatch = _year.firstMatch(working);
    if (yearMatch != null) {
      year = int.tryParse(yearMatch.group(1) ?? yearMatch.group(2) ?? '');
      if (year != null) working = working.replaceRange(yearMatch.start, yearMatch.end, ' ');
    }

    String? quality;
    final qualityMatch = _quality.firstMatch(working);
    if (qualityMatch != null) {
      quality = _normalizeQuality(qualityMatch.group(1)!);
      working = working.replaceRange(qualityMatch.start, qualityMatch.end, ' ');
    }

    // Only de-dot names that are *all* separators — a curated title ("Mornings in Ulen") must
    // survive this untouched, while a raw Drive name ("Gravel.Sky.2020.mkv") should not keep its
    // dots once the year came out of it.
    if (!working.contains(' ')) working = working.replaceAll(RegExp(r'[._]+'), ' ');

    final title = working
        .replaceAll(_collapse, ' ')
        .trim()
        .replaceFirst(_trailingJunk, '')
        .trim();

    return MediaMeta(
      title: title.isEmpty ? name : title,
      year: year,
      quality: quality,
      container: mimeType == null ? null : _containers[mimeType.toLowerCase()],
    );
  }

  static String _normalizeQuality(String raw) {
    final lower = raw.toLowerCase();
    if (lower == '2160p' || lower == '4k' || lower == 'uhd') return '4K';
    return lower;
  }

  /// "2019 · 4K · MKV" — whatever subset actually exists, joined; empty when nothing does.
  String get line {
    final parts = <String>[
      if (year != null) '$year',
      ?quality,
      ?container,
    ];
    return parts.join(' · ');
  }

  bool get hasAny => year != null || quality != null || container != null;
}

/// "23 min left" / "1 h 04 m left" for a partially-watched item, or null when there's nothing
/// meaningful to say (no duration recorded yet, or it's finished).
String? remainingLabel(double positionSeconds, double durationSeconds, {bool completed = false}) {
  if (completed || durationSeconds <= 0) return null;
  final remaining = durationSeconds - positionSeconds;
  if (remaining < 60) return null;
  final minutes = (remaining / 60).round();
  if (minutes < 60) return '$minutes min left';
  final hours = minutes ~/ 60;
  final rest = minutes % 60;
  return rest == 0 ? '${hours}h left' : '${hours}h ${rest}m left';
}

/// mm:ss / h:mm:ss, for the player and episode rows.
String formatDuration(double seconds) {
  final total = seconds.isFinite && seconds > 0 ? seconds.round() : 0;
  final h = total ~/ 3600;
  final m = (total % 3600) ~/ 60;
  final s = total % 60;
  String two(int v) => v.toString().padLeft(2, '0');
  return h > 0 ? '$h:${two(m)}:${two(s)}' : '${two(m)}:${two(s)}';
}
