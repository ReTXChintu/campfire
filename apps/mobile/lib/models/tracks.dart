// Audio and subtitle tracks as the backend names them, and the viewer's language settings —
// mirrors apps/backend/src/lib/mediaTracks.ts. Every field here is optional on the wire: a
// backend older than the feature simply doesn't send them, and the apps carry on with the
// player's own track list and labels.

/// One embedded track of a video, under the name an admin gave it (else one made from the file's
/// own tags, e.g. "Hindi 5.1", "English 2"). [n] counts from 1 per kind in file order, which is
/// also mpv's track id — media_kit's `AudioTrack.id` / `SubtitleTrack.id` is the string "$n".
class ViewerTrack {
  final int n;
  final String label;

  /// Canonical ISO 639-2 code ("eng", "hin"), or null when neither the file nor an admin says.
  final String? language;
  final String? languageName;
  final bool isDefault;
  final bool forced;
  final String codec;
  final int? channels;

  const ViewerTrack({
    required this.n,
    required this.label,
    this.language,
    this.languageName,
    this.isDefault = false,
    this.forced = false,
    this.codec = '',
    this.channels,
  });

  String get mpvId => '$n';

  static ViewerTrack? tryParse(Object? json) {
    if (json is! Map) return null;
    final n = json['n'];
    final label = json['label'];
    if (n is! num || label is! String) return null;
    return ViewerTrack(
      n: n.toInt(),
      label: label,
      language: json['language'] as String?,
      languageName: json['languageName'] as String?,
      isDefault: json['isDefault'] as bool? ?? false,
      forced: json['forced'] as bool? ?? false,
      codec: json['codec'] as String? ?? '',
      channels: (json['channels'] as num?)?.toInt(),
    );
  }

  /// Null when the field is absent or null — the file hasn't been read yet (or an older backend).
  static List<ViewerTrack>? tryParseList(Object? json) {
    if (json is! List) return null;
    return [for (final e in json) ?ViewerTrack.tryParse(e)];
  }
}

/// Which subtitles the player starts on: off, an embedded track (mpv sid "$n"), or an uploaded
/// file (an index into the video response's `subtitles`).
class StartSubtitle {
  /// "off" | "embedded" | "external"
  final String source;
  final int? n;
  final int? index;

  const StartSubtitle._(this.source, {this.n, this.index});
  const StartSubtitle.off() : this._('off');
  const StartSubtitle.embedded(int n) : this._('embedded', n: n);
  const StartSubtitle.external(int index) : this._('external', index: index);

  bool get isOff => source == 'off';
  bool get isEmbedded => source == 'embedded';
  bool get isExternal => source == 'external';

  static StartSubtitle? tryParse(Object? json) {
    if (json is! Map) return null;
    switch (json['source']) {
      case 'off':
        return const StartSubtitle.off();
      case 'embedded':
        final n = json['n'];
        return n is num ? StartSubtitle.embedded(n.toInt()) : null;
      case 'external':
        final index = json['index'];
        return index is num ? StartSubtitle.external(index.toInt()) : null;
      default:
        return null;
    }
  }

  @override
  bool operator ==(Object other) =>
      other is StartSubtitle && other.source == source && other.n == n && other.index == index;

  @override
  int get hashCode => Object.hash(source, n, index);

  @override
  String toString() => 'StartSubtitle($source${n != null ? ' $n' : ''}${index != null ? ' #$index' : ''})';
}

/// A language a title has. [partial]: only some of a series' episodes have it.
class TitleLanguage {
  final String code;
  final String name;
  final bool partial;

  const TitleLanguage({required this.code, required this.name, this.partial = false});

  static TitleLanguage? tryParse(Object? json) {
    if (json is! Map) return null;
    final code = json['code'];
    if (code is! String) return null;
    final name = json['name'];
    return TitleLanguage(
      code: code,
      name: name is String && name.isNotEmpty ? name : code,
      partial: json['partial'] as bool? ?? false,
    );
  }
}

class TitleLanguages {
  final List<TitleLanguage> audio;
  final List<TitleLanguage> subtitles;

  const TitleLanguages({this.audio = const [], this.subtitles = const []});

  bool get isEmpty => audio.isEmpty && subtitles.isEmpty;

  static TitleLanguages? tryParse(Object? json) {
    if (json is! Map) return null;
    List<TitleLanguage> list(Object? v) => v is List ? [for (final e in v) ?TitleLanguage.tryParse(e)] : const [];
    return TitleLanguages(audio: list(json['audio']), subtitles: list(json['subtitles']));
  }

  /// "Audio: Hindi, Tamil (some episodes) · Subtitles: English" as its two halves, leaving out a
  /// half with nothing in it. Empty when there is nothing to say.
  List<String> get parts {
    String names(List<TitleLanguage> list) =>
        list.map((l) => l.partial ? '${l.name} (some episodes)' : l.name).join(', ');
    return [
      if (audio.isNotEmpty) 'Audio: ${names(audio)}',
      if (subtitles.isNotEmpty) 'Subtitles: ${names(subtitles)}',
    ];
  }
}

/// The viewer's own languages (profile), which every title starts in.
class LanguagePrefs {
  /// Up to three canonical codes, most wanted first.
  final List<String> audio;

  /// Code of the subtitle language; required unless [subtitleMode] is "off".
  final String? subtitles;

  /// "off" | "always" | "foreign" (only when the audio isn't one of [audio]).
  final String subtitleMode;

  const LanguagePrefs({this.audio = const [], this.subtitles, this.subtitleMode = 'off'});

  static const modes = ['off', 'foreign', 'always'];

  static LanguagePrefs? tryParse(Object? json) {
    if (json is! Map) return null;
    final mode = json['subtitleMode'];
    return LanguagePrefs(
      audio: (json['audio'] as List?)?.whereType<String>().toList() ?? const [],
      subtitles: json['subtitles'] as String?,
      subtitleMode: mode is String && modes.contains(mode) ? mode : 'off',
    );
  }

  Map<String, dynamic> toJson() => {'audio': audio, 'subtitles': subtitles, 'subtitleMode': subtitleMode};

  LanguagePrefs copyWith({List<String>? audio, Object? subtitles = _keep, String? subtitleMode}) => LanguagePrefs(
        audio: audio ?? this.audio,
        subtitles: identical(subtitles, _keep) ? this.subtitles : subtitles as String?,
        subtitleMode: subtitleMode ?? this.subtitleMode,
      );

  static const Object _keep = Object();
}

/// One option for the language pickers (`GET /api/languages`).
class LanguageOption {
  final String code;
  final String name;

  /// Some title in the library has it — offered first-class in the pickers.
  final bool inLibrary;

  const LanguageOption({required this.code, required this.name, this.inLibrary = false});

  static LanguageOption? tryParse(Object? json) {
    if (json is! Map) return null;
    final code = json['code'];
    if (code is! String) return null;
    final name = json['name'];
    return LanguageOption(
      code: code,
      name: name is String && name.isNotEmpty ? name : code,
      inLibrary: json['inLibrary'] as bool? ?? false,
    );
  }
}
