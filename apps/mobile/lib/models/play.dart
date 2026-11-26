// Playing any title on TMDb, in the library or not, from the source the viewer picks (backend
// lib/titlePlay.ts, lib/videoSources.ts; web apps/frontend/src/lib/play.ts, lib/players.ts).

/// One source added in admin, as a viewer picks from it (`GET /api/sources`).
class ViewerSource {
  final String id;
  final String name;

  const ViewerSource({required this.id, required this.name});

  static ViewerSource? tryParse(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    final id = json['id'];
    final name = json['name'];
    if (id is! String || name is! String) return null;
    return ViewerSource(id: id, name: name);
  }

  static List<ViewerSource> listOf(Object? json) => [for (final e in (json as List? ?? const [])) ?ViewerSource.tryParse(e)];
}

/// Which of Campfire's own player controls a source leaves on.
class PlayerFeatures {
  final Set<String> off;

  const PlayerFeatures([this.off = const {}]);

  bool has(String feature) => !off.contains(feature);

  bool get autoplay => has('autoplay');
  bool get captions => has('captions');
  bool get sourceMenu => has('sourceMenu');
  bool get pip => has('pip');
  bool get fullscreen => has('fullscreen');
  bool get settings => has('settings');
  bool get volume => has('volume');

  static PlayerFeatures parse(Object? json) {
    if (json is! Map<String, dynamic>) return const PlayerFeatures();
    return PlayerFeatures({for (final e in json.entries) if (e.value == false) e.key});
  }
}

/// How a player added by its embed code is drawn (backend lib/frameSource.ts `Frame`).
class PlayerFrame {
  final String allow;
  final bool allowFullscreen;
  final String sandbox;
  final String referrerPolicy;

  /// Width over height; null when the code fills its container.
  final double? ratio;

  const PlayerFrame({
    this.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture',
    this.allowFullscreen = true,
    this.sandbox = 'allow-scripts allow-same-origin allow-presentation',
    this.referrerPolicy = 'strict-origin-when-cross-origin',
    this.ratio,
  });

  /// The listed services' players (an embed set on a title).
  static const standard = PlayerFrame();

  static PlayerFrame parse(Object? json) {
    if (json is! Map<String, dynamic>) return standard;
    return PlayerFrame(
      allow: json['allow'] as String? ?? standard.allow,
      allowFullscreen: json['allowFullscreen'] as bool? ?? true,
      sandbox: json['sandbox'] as String? ?? standard.sandbox,
      referrerPolicy: json['referrerPolicy'] as String? ?? standard.referrerPolicy,
      ratio: (json['ratio'] as num?)?.toDouble(),
    );
  }
}

enum PlayerKind { embed, frame, stream, drive }

/// One way to play a title (`players` on `GET /api/video`). `id` is what it's asked for by.
class PlayerOption {
  final String id;
  final PlayerKind kind;
  final String name;

  /// The page to load, for an embed or a frame.
  final String? url;
  final PlayerFrame frame;
  final PlayerFeatures features;

  const PlayerOption({
    required this.id,
    required this.kind,
    required this.name,
    this.url,
    this.frame = PlayerFrame.standard,
    this.features = const PlayerFeatures(),
  });

  /// Plays in another site's own player, in a web view.
  bool get isWeb => kind == PlayerKind.embed || kind == PlayerKind.frame;

  static PlayerOption? tryParse(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    final id = json['id'];
    final name = json['name'];
    final kind = switch (json['kind']) {
      'embed' => PlayerKind.embed,
      'frame' => PlayerKind.frame,
      'stream' => PlayerKind.stream,
      'drive' => PlayerKind.drive,
      _ => null,
    };
    if (id is! String || name is! String || kind == null) return null;
    final url = json['url'];
    if ((kind == PlayerKind.embed || kind == PlayerKind.frame) && url is! String) return null;
    return PlayerOption(
      id: id,
      kind: kind,
      name: name,
      url: url as String?,
      frame: kind == PlayerKind.frame ? PlayerFrame.parse(json['frame']) : PlayerFrame.standard,
      features: PlayerFeatures.parse(json['features']),
    );
  }

  static List<PlayerOption> listOf(Object? json) => [for (final e in (json as List? ?? const [])) ?PlayerOption.tryParse(e)];
}

/// Where a title streams from in one source (`GET /api/source-stream/:sourceId/:fileId`): an HLS
/// address good for twelve hours, and caption files the host keeps beside it.
class SourceStream {
  final String url;
  final List<({String language, String label, String url})> captions;

  const SourceStream({required this.url, this.captions = const []});

  factory SourceStream.fromJson(Map<String, dynamic> json) => SourceStream(
        url: json['url'] as String,
        captions: [
          for (final c in (json['captions'] as List? ?? const []))
            if (c is Map<String, dynamic> && c['url'] is String)
              (language: c['language'] as String? ?? '', label: c['label'] as String? ?? '', url: c['url'] as String),
        ],
      );
}

/// Whether a video id is a title's own ("tmdb:movie:603", "tmdb:tv:1396:s1e2"), not one of the
/// library's files.
bool isTitleId(String id) => id.startsWith('tmdb:');

/// Where playing a title from a source goes in this app: `/play/movie/603?source=…`, which asks the
/// server where the title is watched (a series carries on where the viewer stopped) and goes there.
String playRoute({required String type, required String id, int? season, int? episode, required String source}) {
  final query = <String, String>{
    'source': source,
    if (season != null && episode != null) 'season': '$season',
    if (season != null && episode != null) 'episode': '$episode',
  };
  return Uri(path: '/play/$type/$id', queryParameters: query).toString();
}

/// One of a series' episodes, with the viewer's progress (`GET /api/title/tv/:id/episodes`).
class SeriesEpisode {
  final int number;
  final String name;
  final String? overview;
  final String? airDate;
  final int? runtimeMinutes;
  final double? rating;
  final bool aired;
  final String? stillUrl;
  final double? positionSeconds;
  final double? durationSeconds;
  final bool completed;

  const SeriesEpisode({
    required this.number,
    required this.name,
    this.overview,
    this.airDate,
    this.runtimeMinutes,
    this.rating,
    this.aired = true,
    this.stillUrl,
    this.positionSeconds,
    this.durationSeconds,
    this.completed = false,
  });

  /// 0–1 of the way through; 0 when not started.
  double get progress {
    if (completed) return 1;
    final p = positionSeconds;
    final d = durationSeconds;
    if (p == null || d == null || d <= 0) return 0;
    return (p / d).clamp(0, 1).toDouble();
  }

  static SeriesEpisode? tryParse(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    final number = (json['number'] as num?)?.toInt();
    if (number == null) return null;
    final progress = json['progress'];
    final rating = json['rating'];
    return SeriesEpisode(
      number: number,
      name: json['name'] as String? ?? 'Episode $number',
      overview: json['overview'] as String?,
      airDate: json['airDate'] as String?,
      runtimeMinutes: (json['runtimeMinutes'] as num?)?.toInt(),
      rating: rating is Map<String, dynamic> ? (rating['average'] as num?)?.toDouble() : null,
      aired: json['aired'] != false,
      stillUrl: json['stillUrl'] as String?,
      positionSeconds: progress is Map<String, dynamic> ? (progress['positionSeconds'] as num?)?.toDouble() : null,
      durationSeconds: progress is Map<String, dynamic> ? (progress['durationSeconds'] as num?)?.toDouble() : null,
      completed: progress is Map<String, dynamic> && progress['completed'] == true,
    );
  }
}

class SeriesSeason {
  final int number;
  final String name;
  final int count;

  const SeriesSeason({required this.number, required this.name, required this.count});
}

class SeriesEpisodes {
  final List<SeriesSeason> seasons;
  final int season;
  final ({int season, int episode, bool started}) resume;
  final List<SeriesEpisode> episodes;

  const SeriesEpisodes({required this.seasons, required this.season, required this.resume, required this.episodes});

  /// "Resume S2 E3" / "Play S1 E1".
  String get playLabel => '${resume.started ? 'Resume' : 'Play'} S${resume.season} E${resume.episode}';

  factory SeriesEpisodes.fromJson(Map<String, dynamic> json) {
    final resume = json['resume'] as Map<String, dynamic>? ?? const {};
    final season = (json['season'] as num?)?.toInt() ?? 1;
    return SeriesEpisodes(
      seasons: [
        for (final s in (json['seasons'] as List? ?? const []))
          if (s is Map<String, dynamic> && s['number'] is num)
            SeriesSeason(
              number: (s['number'] as num).toInt(),
              name: s['name'] as String? ?? 'Season ${s['number']}',
              count: (s['count'] as num?)?.toInt() ?? 0,
            ),
      ],
      season: season,
      resume: (
        season: (resume['season'] as num?)?.toInt() ?? season,
        episode: (resume['episode'] as num?)?.toInt() ?? 1,
        started: resume['started'] == true,
      ),
      episodes: [for (final e in (json['episodes'] as List? ?? const [])) ?SeriesEpisode.tryParse(e)],
    );
  }
}

/// What the viewer picks from: a title's own embeds first, then every source added in admin (an
/// older backend's list is the players themselves, embeds included — each is listed once).
List<ViewerSource> playChoices(List<PlayerOption> players, List<ViewerSource> sources) {
  final seen = <String>{};
  return [
    for (final p in players)
      if (p.kind == PlayerKind.embed && seen.add(p.id)) ViewerSource(id: p.id, name: p.name),
    for (final s in sources)
      if (seen.add(s.id)) s,
  ];
}

/// Which source plays, by the rule every client follows: nothing is tried by itself. A watch party
/// always plays the file; otherwise it's the one picked here, else the one picked before getting here
/// (`?source=`, which the episode before passes on), else the only one there is. Null asks.
String? pickSource({required bool inParty, String? chosen, String? requested, required List<ViewerSource> choices}) {
  if (inParty) return 'drive';
  return chosen ?? requested ?? (choices.length == 1 ? choices.first.id : null);
}
