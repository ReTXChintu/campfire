// Mirrors apps/frontend/src/lib/{catalogListItem,types}.ts — same shapes, since both clients hit
// the same apps/backend REST API.

import 'title_meta.dart';
import 'tracks.dart';

export 'tracks.dart';

sealed class CatalogListItem {
  final String id;
  final String name;

  /// The TMDb facts small enough to fit on a card. Null on anything unmatched.
  final int? year;
  final TmdbRating? rating;

  /// What search, Discover's genre chips and Home's genre rows work from (see models/discovery
  /// .dart). Empty on anything unmatched, and on a backend older than the fields.
  final List<String> genres;
  final List<String> castNames;

  const CatalogListItem({
    required this.id,
    required this.name,
    this.year,
    this.rating,
    this.genres = const [],
    this.castNames = const [],
  });

  factory CatalogListItem.fromJson(Map<String, dynamic> json) {
    final year = (json['year'] as num?)?.toInt();
    final rating = TmdbRating.tryParse(json['rating']);
    final genres = (json['genres'] as List?)?.whereType<String>().toList() ?? const <String>[];
    final castNames = (json['castNames'] as List?)?.whereType<String>().toList() ?? const <String>[];
    return json['kind'] == 'folder'
        ? CatalogFolderItem(
            id: json['id'] as String,
            name: json['name'] as String,
            thumbnailFileId: json['thumbnailFileId'] as String?,
            year: year,
            rating: rating,
            genres: genres,
            castNames: castNames,
          )
        : CatalogVideoItem(
            id: json['id'] as String,
            name: json['name'] as String,
            mimeType: json['mimeType'] as String,
            year: year,
            rating: rating,
            genres: genres,
            castNames: castNames,
            episodeNumber: (json['episodeNumber'] as num?)?.toInt(),
            overview: json['overview'] as String?,
            runtimeMinutes: (json['runtimeMinutes'] as num?)?.toInt(),
            airDate: json['airDate'] as String?,
          );
  }
}

class CatalogFolderItem extends CatalogListItem {
  final String? thumbnailFileId;
  const CatalogFolderItem({
    required super.id,
    required super.name,
    this.thumbnailFileId,
    super.year,
    super.rating,
    super.genres,
    super.castNames,
  });
}

class CatalogVideoItem extends CatalogListItem {
  final String mimeType;

  /// Episode listings only. [episodeNumber] is the episode's own number on TMDb — what an "E4"
  /// label should read — rather than its position in the folder.
  final int? episodeNumber;
  final String? overview;
  final int? runtimeMinutes;
  final String? airDate;

  const CatalogVideoItem({
    required super.id,
    required super.name,
    required this.mimeType,
    super.year,
    super.rating,
    super.genres,
    super.castNames,
    this.episodeNumber,
    this.overview,
    this.runtimeMinutes,
    this.airDate,
  });
}

class WatchProgress {
  final String fileId;
  final String parentFolderId;
  final double positionSeconds;
  final double durationSeconds;
  final bool completed;

  const WatchProgress({
    required this.fileId,
    required this.parentFolderId,
    required this.positionSeconds,
    required this.durationSeconds,
    required this.completed,
  });

  factory WatchProgress.fromJson(Map<String, dynamic> json) => WatchProgress(
    fileId: json['fileId'] as String,
    parentFolderId: json['parentFolderId'] as String,
    positionSeconds: (json['positionSeconds'] as num).toDouble(),
    durationSeconds: (json['durationSeconds'] as num? ?? 0).toDouble(),
    completed: json['completed'] as bool? ?? false,
  );

  /// How much of the bar to fill. A finished title is a *full* bar, not the 95% the completion
  /// threshold happens to land on — "you watched this" has to read at a glance in a list.
  double get fraction {
    if (completed) return 1;
    if (durationSeconds <= 0) return 0;
    return (positionSeconds / durationSeconds).clamp(0.0, 1.0);
  }
}

class StreamTrack {
  final int index;
  final String? language;
  final String? title;
  final String codecName;

  const StreamTrack({required this.index, this.language, this.title, required this.codecName});

  factory StreamTrack.fromJson(Map<String, dynamic> json) => StreamTrack(
    index: json['index'] as int,
    language: json['language'] as String?,
    title: json['title'] as String?,
    codecName: json['codecName'] as String,
  );
}

/// One rung of the adjustable-quality ladder — mirrors apps/backend/src/lib/qualityLadder.ts.
/// Clients never hardcode the ladder; they just render whatever the backend's probe response says
/// is available for this particular video (filtered to below its own source resolution there).
class QualityOption {
  final String label;
  final int height;

  const QualityOption({required this.label, required this.height});

  factory QualityOption.fromJson(Map<String, dynamic> json) =>
      QualityOption(label: json['label'] as String, height: json['height'] as int);
}

class ProbeResult {
  final List<StreamTrack> audioTracks;
  final List<StreamTrack> subtitleTracks;
  final double? durationSeconds;
  final int? sourceHeight;
  final int? sourceWidth;
  final List<QualityOption> availableQualities;

  const ProbeResult({
    required this.audioTracks,
    required this.subtitleTracks,
    this.durationSeconds,
    this.sourceHeight,
    this.sourceWidth,
    this.availableQualities = const [],
  });

  factory ProbeResult.fromJson(Map<String, dynamic> json) => ProbeResult(
    audioTracks: (json['audioTracks'] as List).map((t) => StreamTrack.fromJson(t)).toList(),
    subtitleTracks: (json['subtitleTracks'] as List).map((t) => StreamTrack.fromJson(t)).toList(),
    durationSeconds: (json['durationSeconds'] as num?)?.toDouble(),
    sourceHeight: json['sourceHeight'] as int?,
    sourceWidth: json['sourceWidth'] as int?,
    availableQualities: json['availableQualities'] == null
        ? const []
        : (json['availableQualities'] as List).map((q) => QualityOption.fromJson(q)).toList(),
  );
}

class ConvertedSubtitle {
  final int index;
  final String? language;
  final String? title;
  final String vtt;

  const ConvertedSubtitle({required this.index, this.language, this.title, required this.vtt});

  factory ConvertedSubtitle.fromJson(Map<String, dynamic> json) => ConvertedSubtitle(
    index: json['index'] as int,
    language: json['language'] as String?,
    title: json['title'] as String?,
    vtt: json['vtt'] as String,
  );
}

class HeroData {
  final String title;
  final String badge;
  final String playHref;
  final String? infoHref;
  // A ready-to-fetch backend path (e.g. "/api/thumbnail/<id>"), or null when a folder simply has
  // no thumbnail yet.
  final String? thumbnailPath;

  const HeroData({
    required this.title,
    required this.badge,
    required this.playHref,
    this.infoHref,
    this.thumbnailPath,
  });

  factory HeroData.fromJson(Map<String, dynamic> json) => HeroData(
    title: json['title'] as String,
    badge: json['badge'] as String,
    playHref: json['playHref'] as String,
    infoHref: json['infoHref'] as String?,
    thumbnailPath: json['thumbnailPath'] as String?,
  );
}

/// One slide of the Home spotlight carousel (`spotlight[]` on `GET /api/library`). Supersedes
/// [HeroData], which the backend still sends for older installed builds — new code reads
/// `spotlight` and ignores `hero`. `spotlight[0]` is always a library pick; fulfilled requests are
/// interleaved from slide 2 onwards.
class SpotlightSlide {
  final String id;
  /// "new" | "featured" | "request" — what the badge *says*, not what the item is.
  final String kind;
  final String title;
  final String badge;
  final String playHref;
  final String? infoHref;
  final String? thumbnailPath;

  /// The title's wordmark, when TMDb has one — drawn instead of the title text. Null when there
  /// is none, and on a backend older than the field.
  final String? logoPath;
  // Request slides only.
  final String? requestId;
  final String? requestedByName;
  final bool youAsked;

  const SpotlightSlide({
    required this.id,
    required this.kind,
    required this.title,
    required this.badge,
    required this.playHref,
    this.infoHref,
    this.thumbnailPath,
    this.logoPath,
    this.requestId,
    this.requestedByName,
    this.youAsked = false,
  });

  bool get isRequest => kind == 'request';

  factory SpotlightSlide.fromJson(Map<String, dynamic> json) => SpotlightSlide(
    id: json['id'] as String,
    kind: json['kind'] as String? ?? 'featured',
    title: json['title'] as String,
    badge: json['badge'] as String? ?? '',
    playHref: json['playHref'] as String,
    infoHref: json['infoHref'] as String?,
    thumbnailPath: json['thumbnailPath'] as String?,
    logoPath: json['logoPath'] as String?,
    requestId: json['requestId'] as String?,
    requestedByName: json['requestedByName'] as String?,
    youAsked: json['youAsked'] as bool? ?? false,
  );
}

class ContinueWatchingEntry {
  final CatalogListItem item;
  final WatchProgress progress;
  const ContinueWatchingEntry({required this.item, required this.progress});

  factory ContinueWatchingEntry.fromJson(Map<String, dynamic> json) => ContinueWatchingEntry(
    item: CatalogListItem.fromJson(json['item'] as Map<String, dynamic>),
    progress: WatchProgress.fromJson(json['progress'] as Map<String, dynamic>),
  );
}

class LibraryResponse {
  final bool empty;
  /// Deprecated server-side, kept only so an older build keeps working — the carousel reads
  /// [spotlight]. See widgets/spotlight_carousel.dart.
  final HeroData? hero;
  final List<SpotlightSlide> spotlight;
  final List<ContinueWatchingEntry> continueWatching;
  final List<CatalogListItem> folders;
  final List<CatalogListItem> videos;
  /// This user's progress on the library's own videos, finished ones included — so a movie card
  /// can say it was watched. Absent on a backend older than this field.
  final List<WatchProgress> progress;

  const LibraryResponse({
    required this.empty,
    this.hero,
    this.spotlight = const [],
    required this.continueWatching,
    required this.folders,
    required this.videos,
    this.progress = const [],
  });

  factory LibraryResponse.fromJson(Map<String, dynamic> json) => LibraryResponse(
    empty: json['empty'] as bool,
    hero: json['hero'] == null ? null : HeroData.fromJson(json['hero'] as Map<String, dynamic>),
    spotlight: (json['spotlight'] as List? ?? const [])
        .map((e) => SpotlightSlide.fromJson(e as Map<String, dynamic>))
        .toList(),
    continueWatching: (json['continueWatching'] as List)
        .map((e) => ContinueWatchingEntry.fromJson(e))
        .toList(),
    folders: (json['folders'] as List).map((e) => CatalogListItem.fromJson(e)).toList(),
    videos: (json['videos'] as List).map((e) => CatalogListItem.fromJson(e)).toList(),
    progress: (json['progress'] as List? ?? const [])
        .map((e) => WatchProgress.fromJson(e as Map<String, dynamic>))
        .toList(),
  );
}

class Season {
  final String id;
  final String name;
  const Season({required this.id, required this.name});
  factory Season.fromJson(Map<String, dynamic> json) =>
      Season(id: json['id'] as String, name: json['name'] as String);
}

/// Covers both of the backend's folder response shapes (`mode: "flat" | "series"`) — Dart lacks
/// TypeScript's discriminated-union ergonomics without codegen, so this is one class with the
/// season-specific fields left null in flat mode, same as optional fields on a plain JS object.
class FolderResponse {
  final String mode;
  final String folderId;
  final String title;
  final String backHref;
  final String? thumbnailFileId;

  /// Everything TMDb knows about this title. Empty when it isn't matched, or on an older backend.
  final TitleMeta meta;
  final List<CatalogListItem> items; // flat mode only
  final List<Season> seasons; // series mode only
  final String? selectedSeasonId;
  final List<CatalogListItem> seasonItems;
  final List<CatalogListItem> specialItems;
  final List<WatchProgress> progress;

  /// Audio and subtitle languages across its published episodes. Null until they've been read,
  /// and on a backend older than the field.
  final TitleLanguages? languages;

  const FolderResponse({
    required this.mode,
    required this.folderId,
    required this.title,
    required this.backHref,
    this.thumbnailFileId,
    this.meta = const TitleMeta(),
    this.items = const [],
    this.seasons = const [],
    this.selectedSeasonId,
    this.seasonItems = const [],
    this.specialItems = const [],
    this.progress = const [],
    this.languages,
  });

  bool get isSeries => mode == 'series';

  factory FolderResponse.fromJson(Map<String, dynamic> json) => FolderResponse(
    mode: json['mode'] as String,
    folderId: json['folderId'] as String,
    title: (json['title'] as String?) ?? '',
    backHref: json['backHref'] as String,
    thumbnailFileId: json['thumbnailFileId'] as String?,
    meta: TitleMeta.fromJson(json),
    items: json['items'] == null
        ? const []
        : (json['items'] as List).map((e) => CatalogListItem.fromJson(e)).toList(),
    seasons: json['seasons'] == null
        ? const []
        : (json['seasons'] as List).map((e) => Season.fromJson(e)).toList(),
    selectedSeasonId: json['selectedSeasonId'] as String?,
    seasonItems: json['seasonItems'] == null
        ? const []
        : (json['seasonItems'] as List).map((e) => CatalogListItem.fromJson(e)).toList(),
    specialItems: json['specialItems'] == null
        ? const []
        : (json['specialItems'] as List).map((e) => CatalogListItem.fromJson(e)).toList(),
    progress: json['progress'] == null
        ? const []
        : (json['progress'] as List).map((e) => WatchProgress.fromJson(e)).toList(),
    languages: TitleLanguages.tryParse(json['languages']),
  );
}

class EpisodeRef {
  final String id;
  final String name;

  /// The episode's own number on TMDb, when its series is matched — what an "E4" label should
  /// read. Null on anything unmatched, and on a backend older than the field.
  final int? episodeNumber;

  const EpisodeRef({required this.id, required this.name, this.episodeNumber});

  factory EpisodeRef.fromJson(Map<String, dynamic> json) => EpisodeRef(
    id: json['id'] as String,
    name: json['name'] as String,
    episodeNumber: (json['episodeNumber'] as num?)?.toInt(),
  );
}

class EpisodeProgress {
  final double positionSeconds;
  final double durationSeconds;
  final bool completed;
  const EpisodeProgress({required this.positionSeconds, this.durationSeconds = 0, required this.completed});
  factory EpisodeProgress.fromJson(Map<String, dynamic> json) => EpisodeProgress(
    positionSeconds: (json['positionSeconds'] as num).toDouble(),
    durationSeconds: (json['durationSeconds'] as num? ?? 0).toDouble(),
    completed: json['completed'] as bool,
  );

  /// Full when finished, see [WatchProgress.fraction].
  double get fraction {
    if (completed) return 1;
    if (durationSeconds <= 0) return 0;
    return (positionSeconds / durationSeconds).clamp(0.0, 1.0);
  }
}

/// One "Up next" choice — see apps/backend/src/lib/upNext.ts.
class UpNextItem {
  /// "episode" (the next one in this series) or "suggestion" (another title).
  final String kind;

  /// The video to play — for a suggested series, its first episode.
  final String fileId;
  final String title;

  /// "S2 E1 · House of the Dragon", or a suggestion's reason ("With Matt Smith").
  final String? subtitle;

  /// Backend path of its image (an episode still, or the title's artwork).
  final String imagePath;
  final String? overview;

  /// A suggested series' own page (`/folder/<id>`); null for an episode or a film.
  final String? infoHref;

  const UpNextItem({
    required this.kind,
    required this.fileId,
    required this.title,
    this.subtitle,
    required this.imagePath,
    this.overview,
    this.infoHref,
  });

  bool get isEpisode => kind == 'episode';

  static UpNextItem? tryParse(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    final fileId = json['fileId'];
    final title = json['title'];
    final imagePath = json['imagePath'];
    if (fileId is! String || title is! String || imagePath is! String) return null;
    return UpNextItem(
      kind: (json['kind'] as String?) ?? 'suggestion',
      fileId: fileId,
      title: title,
      subtitle: json['subtitle'] as String?,
      imagePath: imagePath,
      overview: json['overview'] as String?,
      infoHref: json['infoHref'] as String?,
    );
  }
}

/// A hosting service's own player for this title (backend lib/embed.ts).
class VideoEmbed {
  final String provider;
  final String url;

  const VideoEmbed({required this.provider, required this.url});

  static VideoEmbed? tryParse(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    final provider = json['provider'];
    final url = json['url'];
    if (provider is! String || url is! String) return null;
    return VideoEmbed(provider: provider, url: url);
  }
}

class VideoResponse {
  final String fileId;
  final String title;
  final String backHref;
  final String parentFolderId;
  final String? nextFileId;
  final String? previousFileId;
  final List<EpisodeRef> episodes;
  final Map<String, EpisodeProgress> progressByFileId;
  final double initialPositionSeconds;
  final bool initialCompleted;
  /// Players to offer, in order, before the file itself. Empty from an older backend.
  final List<VideoEmbed> embeds;
  final String seekMode; // "native" | "restart" | "raw" (MKV — see MkvVideoPlayer)
  final double? durationSeconds;
  final List<ConvertedSubtitle> subtitles;
  final double? introStart;
  final double? introEnd;
  final double? outroStart;
  // Remembered track choices (see apps/backend/src/lib/progress.ts) — null means "no preference
  // recorded yet", not "off". initialSubtitleSource "off"|"external"|"restart"|null;
  // initialSubtitleIndex only meaningful when source is "external" (an index into `subtitles`
  // above) or "restart" (a raw ffprobe stream index — MediaKitVideoPlayer never has this source,
  // since it doesn't use restart-mode subtitle extraction) *and* the preference came from this
  // exact video's own history — null when it's a series-wide fallback from a sibling episode,
  // since a raw index only means something within a single video's own track list.
  // initialSubtitleLanguage/initialSubtitleTitle are the portable name-based identity to match
  // against `subtitles`/the probe's subtitle tracks instead (preferred even for the same-video
  // case — more robust than a raw index). Audio is matched by language+title rather than a raw
  // index since the identifier space differs by player (see progress.ts).
  final String? initialSubtitleSource;
  final int? initialSubtitleIndex;
  final String? initialSubtitleLanguage;
  final String? initialSubtitleTitle;
  final String? initialAudioLanguage;
  final String? initialAudioTitle;

  /// The film's own TMDb facts, when this video is one. Empty for an episode.
  final TitleMeta meta;

  /// Which episode this is, when it belongs to a matched series. Null for a film.
  final EpisodeMeta? episode;

  /// What the "Up next" card offers near the end: the next episode (crossing into the next
  /// season), or after a film or a finale the library's best match. Null from an older backend.
  final UpNextItem? upNext;

  /// A short "more like this" list for the end screen. Empty from an older backend.
  final List<UpNextItem> suggestions;

  /// The file's embedded tracks under their admin-given names (see models/tracks.dart). Null
  /// until the file has been read, and on an older backend — the player then labels tracks from
  /// mpv's own tags, as before.
  final List<ViewerTrack>? audioTracks;
  final List<ViewerTrack>? subtitleTracks;

  /// The tracks to start on, with this video's own pick, the series' last pick, the viewer's
  /// profile languages and an admin's default already folded in server-side. Null leaves the
  /// file's default (audio) / the player's usual start (subtitles).
  final int? startAudio;
  final StartSubtitle? startSubtitle;

  /// The backend sends start tracks at all. When it does they replace the initialAudio*/
  /// initialSubtitle* matching, which an older backend still needs.
  final bool hasStartTracks;

  /// What this one file has, for the details under the player. Null until read.
  final TitleLanguages? languages;

  const VideoResponse({
    required this.fileId,
    required this.title,
    required this.backHref,
    required this.parentFolderId,
    this.nextFileId,
    this.previousFileId,
    required this.episodes,
    required this.progressByFileId,
    required this.initialPositionSeconds,
    required this.initialCompleted,
    required this.seekMode,
    this.embeds = const [],
    this.durationSeconds,
    required this.subtitles,
    this.introStart,
    this.introEnd,
    this.outroStart,
    this.initialSubtitleSource,
    this.initialSubtitleIndex,
    this.initialSubtitleLanguage,
    this.initialSubtitleTitle,
    this.initialAudioLanguage,
    this.initialAudioTitle,
    this.meta = const TitleMeta(),
    this.episode,
    this.upNext,
    this.suggestions = const [],
    this.audioTracks,
    this.subtitleTracks,
    this.startAudio,
    this.startSubtitle,
    this.hasStartTracks = false,
    this.languages,
  });

  bool get isNative => seekMode == 'native';
  bool get isRaw => seekMode == 'raw';

  factory VideoResponse.fromJson(Map<String, dynamic> json) => VideoResponse(
    fileId: json['fileId'] as String,
    title: (json['title'] as String?) ?? '',
    meta: TitleMeta.fromJson(json),
    episode: EpisodeMeta.tryParse(json['episode']),
    upNext: UpNextItem.tryParse(json['upNext']),
    suggestions: [
      for (final e in (json['suggestions'] as List?) ?? const [])
        ?UpNextItem.tryParse(e),
    ],
    backHref: json['backHref'] as String,
    parentFolderId: json['parentFolderId'] as String,
    nextFileId: json['nextFileId'] as String?,
    previousFileId: json['previousFileId'] as String?,
    episodes: (json['episodes'] as List).map((e) => EpisodeRef.fromJson(e)).toList(),
    progressByFileId: (json['progressByFileId'] as Map<String, dynamic>).map(
      (k, v) => MapEntry(k, EpisodeProgress.fromJson(v as Map<String, dynamic>)),
    ),
    initialPositionSeconds: (json['initialPositionSeconds'] as num).toDouble(),
    initialCompleted: json['initialCompleted'] as bool,
    seekMode: json['seekMode'] as String,
    embeds: [for (final e in (json['embeds'] as List?) ?? const []) ?VideoEmbed.tryParse(e)],
    durationSeconds: (json['durationSeconds'] as num?)?.toDouble(),
    subtitles: (json['subtitles'] as List).map((e) => ConvertedSubtitle.fromJson(e)).toList(),
    introStart: (json['introStart'] as num?)?.toDouble(),
    introEnd: (json['introEnd'] as num?)?.toDouble(),
    outroStart: (json['outroStart'] as num?)?.toDouble(),
    initialSubtitleSource: json['initialSubtitleSource'] as String?,
    initialSubtitleIndex: json['initialSubtitleIndex'] as int?,
    initialSubtitleLanguage: json['initialSubtitleLanguage'] as String?,
    initialSubtitleTitle: json['initialSubtitleTitle'] as String?,
    initialAudioLanguage: json['initialAudioLanguage'] as String?,
    initialAudioTitle: json['initialAudioTitle'] as String?,
    audioTracks: ViewerTrack.tryParseList(json['audioTracks']),
    subtitleTracks: ViewerTrack.tryParseList(json['subtitleTracks']),
    startAudio: (json['startAudio'] as num?)?.toInt(),
    startSubtitle: StartSubtitle.tryParse(json['startSubtitle']),
    hasStartTracks: json.containsKey('startAudio') || json.containsKey('startSubtitle'),
    languages: TitleLanguages.tryParse(json['languages']),
  );
}
