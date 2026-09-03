// Mirrors apps/frontend/src/lib/types.ts's CatalogFolder/CatalogVideo and the admin-only response
// shapes from apps/frontend/src/hooks/useAdminCatalog.ts. Admin-only models live separately from
// models/catalog.dart's lightweight CatalogListItem — the admin screens need the full curation
// fields (status, driveName, intro/outro, etc.) that the viewer-facing catalog never touches.

class CatalogFolder {
  final String id;
  final String parentFolderId;
  final String driveName;
  final String? thumbnailFileId;
  final String status; // "pending" | "curated" | "published"
  final String? title;
  final String? curatedAt;

  const CatalogFolder({
    required this.id,
    required this.parentFolderId,
    required this.driveName,
    this.thumbnailFileId,
    required this.status,
    this.title,
    this.curatedAt,
  });

  factory CatalogFolder.fromJson(Map<String, dynamic> json) => CatalogFolder(
    id: json['_id'] as String,
    parentFolderId: json['parentFolderId'] as String,
    driveName: json['driveName'] as String,
    thumbnailFileId: json['thumbnailFileId'] as String?,
    status: json['status'] as String,
    title: json['title'] as String?,
    curatedAt: json['curatedAt'] as String?,
  );
}

class CatalogVideo {
  final String id;
  final String parentFolderId;
  final String driveName;
  final String mimeType;
  final String status; // "pending" | "curated" | "published"
  final String? title;
  final List<String> subtitleSetIds;
  final double? introStart;
  final double? introEnd;
  final double? outroStart;

  const CatalogVideo({
    required this.id,
    required this.parentFolderId,
    required this.driveName,
    required this.mimeType,
    required this.status,
    this.title,
    required this.subtitleSetIds,
    this.introStart,
    this.introEnd,
    this.outroStart,
  });

  // Mirrors apps/backend/src/lib/drive.ts's isMkv() — Drive's own detector reports plain
  // "video/matroska" for at least some files, not just the IANA-registered "video/x-matroska".
  bool get isMkv => mimeType == 'video/x-matroska' || mimeType == 'video/matroska';

  factory CatalogVideo.fromJson(Map<String, dynamic> json) => CatalogVideo(
    id: json['_id'] as String,
    parentFolderId: json['parentFolderId'] as String,
    driveName: json['driveName'] as String,
    mimeType: json['mimeType'] as String,
    status: json['status'] as String,
    title: json['title'] as String?,
    subtitleSetIds: (json['subtitleSetIds'] as List? ?? const []).map((e) => e as String).toList(),
    introStart: (json['introStart'] as num?)?.toDouble(),
    introEnd: (json['introEnd'] as num?)?.toDouble(),
    outroStart: (json['outroStart'] as num?)?.toDouble(),
  );
}

class AdminOverview {
  final List<CatalogFolder> pendingFolders;
  final List<CatalogVideo> pendingVideos;
  final List<CatalogFolder> unpublishedFolders;
  final List<CatalogVideo> unpublishedVideos;
  final List<CatalogFolder> rootFolders;
  final List<CatalogVideo> rootVideos;

  const AdminOverview({
    required this.pendingFolders,
    required this.pendingVideos,
    required this.unpublishedFolders,
    required this.unpublishedVideos,
    required this.rootFolders,
    required this.rootVideos,
  });

  factory AdminOverview.fromJson(Map<String, dynamic> json) => AdminOverview(
    pendingFolders: (json['pendingFolders'] as List).map((e) => CatalogFolder.fromJson(e)).toList(),
    pendingVideos: (json['pendingVideos'] as List).map((e) => CatalogVideo.fromJson(e)).toList(),
    unpublishedFolders: (json['unpublishedFolders'] as List).map((e) => CatalogFolder.fromJson(e)).toList(),
    unpublishedVideos: (json['unpublishedVideos'] as List).map((e) => CatalogVideo.fromJson(e)).toList(),
    rootFolders: (json['rootFolders'] as List).map((e) => CatalogFolder.fromJson(e)).toList(),
    rootVideos: (json['rootVideos'] as List).map((e) => CatalogVideo.fromJson(e)).toList(),
  );
}

class AdminFolderDetail {
  final CatalogFolder folder;
  final List<CatalogFolder> breadcrumbs;
  final List<CatalogFolder> childFolders;
  final List<CatalogVideo> childVideos;

  const AdminFolderDetail({
    required this.folder,
    required this.breadcrumbs,
    required this.childFolders,
    required this.childVideos,
  });

  factory AdminFolderDetail.fromJson(Map<String, dynamic> json) => AdminFolderDetail(
    folder: CatalogFolder.fromJson(json['folder'] as Map<String, dynamic>),
    breadcrumbs: (json['breadcrumbs'] as List).map((e) => CatalogFolder.fromJson(e)).toList(),
    childFolders: (json['childFolders'] as List).map((e) => CatalogFolder.fromJson(e)).toList(),
    childVideos: (json['childVideos'] as List).map((e) => CatalogVideo.fromJson(e)).toList(),
  );
}

class SubtitleTrackInfo {
  final int index;
  final String? language;
  final String? title;

  const SubtitleTrackInfo({required this.index, this.language, this.title});

  factory SubtitleTrackInfo.fromJson(Map<String, dynamic> json) => SubtitleTrackInfo(
    index: json['index'] as int,
    language: json['language'] as String?,
    title: json['title'] as String?,
  );
}

class SubtitleSetOption {
  final String id;
  final String sourceLabel;
  final List<SubtitleTrackInfo> tracks;

  const SubtitleSetOption({required this.id, required this.sourceLabel, required this.tracks});

  factory SubtitleSetOption.fromJson(Map<String, dynamic> json) => SubtitleSetOption(
    id: json['id'] as String,
    sourceLabel: json['sourceLabel'] as String,
    tracks: (json['tracks'] as List).map((e) => SubtitleTrackInfo.fromJson(e)).toList(),
  );
}

class AdminVideoDetail {
  final CatalogVideo video;
  final CatalogFolder? parentFolder;
  final List<SubtitleSetOption> subtitleSetOptions;

  const AdminVideoDetail({required this.video, this.parentFolder, required this.subtitleSetOptions});

  factory AdminVideoDetail.fromJson(Map<String, dynamic> json) => AdminVideoDetail(
    video: CatalogVideo.fromJson(json['video'] as Map<String, dynamic>),
    parentFolder: json['parentFolder'] == null
        ? null
        : CatalogFolder.fromJson(json['parentFolder'] as Map<String, dynamic>),
    subtitleSetOptions: (json['subtitleSetOptions'] as List)
        .map((e) => SubtitleSetOption.fromJson(e))
        .toList(),
  );
}

class DeletedCatalogItem {
  final String id;
  final String driveName;
  const DeletedCatalogItem({required this.id, required this.driveName});
  factory DeletedCatalogItem.fromJson(Map<String, dynamic> json) =>
      DeletedCatalogItem(id: json['id'] as String, driveName: json['driveName'] as String);
}

class ScanResult {
  final int foldersScanned;
  final int videosScanned;
  final int foldersAdded;
  final int videosAdded;
  final int foldersDeleted;
  final int videosDeleted;
  final List<DeletedCatalogItem> deletedFolders;
  final List<DeletedCatalogItem> deletedVideos;
  final List<String> erroredFolderIds;

  const ScanResult({
    required this.foldersScanned,
    required this.videosScanned,
    required this.foldersAdded,
    required this.videosAdded,
    required this.foldersDeleted,
    required this.videosDeleted,
    required this.deletedFolders,
    required this.deletedVideos,
    required this.erroredFolderIds,
  });

  factory ScanResult.fromJson(Map<String, dynamic> json) => ScanResult(
    foldersScanned: json['foldersScanned'] as int,
    videosScanned: json['videosScanned'] as int,
    foldersAdded: json['foldersAdded'] as int,
    videosAdded: json['videosAdded'] as int,
    foldersDeleted: json['foldersDeleted'] as int,
    videosDeleted: json['videosDeleted'] as int,
    deletedFolders: (json['deletedFolders'] as List).map((e) => DeletedCatalogItem.fromJson(e)).toList(),
    deletedVideos: (json['deletedVideos'] as List).map((e) => DeletedCatalogItem.fromJson(e)).toList(),
    erroredFolderIds: (json['erroredFolderIds'] as List).map((e) => e as String).toList(),
  );
}
