// Mirrors apps/frontend/src/lib/{catalogListItem,types}.ts — same shapes, since both clients hit
// the same apps/backend REST API.

sealed class CatalogListItem {
  final String id;
  final String name;

  const CatalogListItem({required this.id, required this.name});

  factory CatalogListItem.fromJson(Map<String, dynamic> json) {
    return json['kind'] == 'folder'
        ? CatalogFolderItem(
            id: json['id'] as String,
            name: json['name'] as String,
            thumbnailFileId: json['thumbnailFileId'] as String?,
          )
        : CatalogVideoItem(
            id: json['id'] as String,
            name: json['name'] as String,
            mimeType: json['mimeType'] as String,
          );
  }
}

class CatalogFolderItem extends CatalogListItem {
  final String? thumbnailFileId;
  const CatalogFolderItem({required super.id, required super.name, this.thumbnailFileId});
}

class CatalogVideoItem extends CatalogListItem {
  final String mimeType;
  const CatalogVideoItem({required super.id, required super.name, required this.mimeType});
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
    durationSeconds: (json['durationSeconds'] as num).toDouble(),
    completed: json['completed'] as bool,
  );
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

  const HeroData({required this.title, required this.badge, required this.playHref, this.infoHref});

  factory HeroData.fromJson(Map<String, dynamic> json) => HeroData(
    title: json['title'] as String,
    badge: json['badge'] as String,
    playHref: json['playHref'] as String,
    infoHref: json['infoHref'] as String?,
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
  final HeroData? hero;
  final List<ContinueWatchingEntry> continueWatching;
  final List<CatalogListItem> folders;
  final List<CatalogListItem> videos;

  const LibraryResponse({
    required this.empty,
    this.hero,
    required this.continueWatching,
    required this.folders,
    required this.videos,
  });

  factory LibraryResponse.fromJson(Map<String, dynamic> json) => LibraryResponse(
    empty: json['empty'] as bool,
    hero: json['hero'] == null ? null : HeroData.fromJson(json['hero'] as Map<String, dynamic>),
    continueWatching: (json['continueWatching'] as List)
        .map((e) => ContinueWatchingEntry.fromJson(e))
        .toList(),
    folders: (json['folders'] as List).map((e) => CatalogListItem.fromJson(e)).toList(),
    videos: (json['videos'] as List).map((e) => CatalogListItem.fromJson(e)).toList(),
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
  final List<CatalogListItem> items; // flat mode only
  final List<Season> seasons; // series mode only
  final String? selectedSeasonId;
  final List<CatalogListItem> seasonItems;
  final List<CatalogListItem> specialItems;
  final List<WatchProgress> progress;

  const FolderResponse({
    required this.mode,
    required this.folderId,
    required this.title,
    required this.backHref,
    this.thumbnailFileId,
    this.items = const [],
    this.seasons = const [],
    this.selectedSeasonId,
    this.seasonItems = const [],
    this.specialItems = const [],
    this.progress = const [],
  });

  bool get isSeries => mode == 'series';

  factory FolderResponse.fromJson(Map<String, dynamic> json) => FolderResponse(
    mode: json['mode'] as String,
    folderId: json['folderId'] as String,
    title: (json['title'] as String?) ?? '',
    backHref: json['backHref'] as String,
    thumbnailFileId: json['thumbnailFileId'] as String?,
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
  );
}

class EpisodeRef {
  final String id;
  final String name;
  const EpisodeRef({required this.id, required this.name});
  factory EpisodeRef.fromJson(Map<String, dynamic> json) =>
      EpisodeRef(id: json['id'] as String, name: json['name'] as String);
}

class EpisodeProgress {
  final double positionSeconds;
  final bool completed;
  const EpisodeProgress({required this.positionSeconds, required this.completed});
  factory EpisodeProgress.fromJson(Map<String, dynamic> json) => EpisodeProgress(
    positionSeconds: (json['positionSeconds'] as num).toDouble(),
    completed: json['completed'] as bool,
  );
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
  final String seekMode; // "native" | "restart" | "raw" (MKV — see MkvVideoPlayer)
  final double? durationSeconds;
  final List<ConvertedSubtitle> subtitles;
  final double? introStart;
  final double? introEnd;
  final double? outroStart;

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
    this.durationSeconds,
    required this.subtitles,
    this.introStart,
    this.introEnd,
    this.outroStart,
  });

  bool get isNative => seekMode == 'native';
  bool get isRaw => seekMode == 'raw';

  factory VideoResponse.fromJson(Map<String, dynamic> json) => VideoResponse(
    fileId: json['fileId'] as String,
    title: (json['title'] as String?) ?? '',
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
    durationSeconds: (json['durationSeconds'] as num?)?.toDouble(),
    subtitles: (json['subtitles'] as List).map((e) => ConvertedSubtitle.fromJson(e)).toList(),
    introStart: (json['introStart'] as num?)?.toDouble(),
    introEnd: (json['introEnd'] as num?)?.toDouble(),
    outroStart: (json['outroStart'] as num?)?.toDouble(),
  );
}
