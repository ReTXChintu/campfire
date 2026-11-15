import '../models/admin_catalog.dart';
import 'api_client.dart';

/// Desktop-only (see platform_info.dart's isDesktopAdminCapable) — mirrors the endpoint surface
/// apps/frontend/src/hooks/useAdminCatalog.ts calls on apps/backend's /api/admin/* routes.
class AdminCatalogService {
  AdminCatalogService._();

  static Future<AdminOverview> fetchOverview() async {
    final data = await ApiClient.get('/api/admin/catalog/overview') as Map<String, dynamic>;
    return AdminOverview.fromJson(data);
  }

  static Future<AdminFolderDetail> fetchFolder(String folderId) async {
    final data = await ApiClient.get('/api/admin/catalog/folder/$folderId') as Map<String, dynamic>;
    return AdminFolderDetail.fromJson(data);
  }

  static Future<AdminVideoDetail> fetchVideo(String fileId) async {
    final data = await ApiClient.get('/api/admin/catalog/video/$fileId') as Map<String, dynamic>;
    return AdminVideoDetail.fromJson(data);
  }

  // --- Artwork (backend routes/admin/artwork.ts); kind is "folder" or "video". ---

  static Future<void> setArtworkLink(String kind, String id, String link) {
    return ApiClient.put('/api/admin/catalog/artwork/$kind/$id', {'link': link});
  }

  static Future<void> matchArtwork(String kind, String id) {
    return ApiClient.post('/api/admin/catalog/artwork/$kind/$id/auto');
  }

  static Future<void> clearArtwork(String kind, String id) {
    return ApiClient.delete('/api/admin/catalog/artwork/$kind/$id');
  }

  /// Rename one title to the name TMDb uses. Unlike the rename a match does on its own, this
  /// overwrites a hand-typed name — an admin pressed a button that says so.
  static Future<String> useTmdbTitle(String kind, String id) async {
    final data = await ApiClient.post('/api/admin/catalog/artwork/$kind/$id/use-tmdb-title');
    return (data as Map<String, dynamic>)['to'] as String;
  }

  /// Name one series' episodes from TMDb now.
  static Future<EpisodeMatchResult> matchEpisodes(String folderId) async {
    final data = await ApiClient.post('/api/admin/catalog/artwork/folder/$folderId/episodes');
    return EpisodeMatchResult.fromJson(data as Map<String, dynamic>);
  }

  /// Which season of its series this folder holds (null goes back to guessing from its name).
  static Future<EpisodeMatchResult> setFolderSeason(String folderId, int? season) async {
    final data = await ApiClient.put(
      '/api/admin/catalog/artwork/folder/$folderId/season',
      {'season': season},
    );
    return EpisodeMatchResult.fromJson(data as Map<String, dynamic>);
  }

  /// Turn TMDb episode naming on or off for one series.
  static Future<void> setEpisodeNaming(String folderId, {required bool enabled}) {
    return ApiClient.put(
      '/api/admin/catalog/artwork/folder/$folderId/episode-naming',
      {'enabled': enabled},
    );
  }

  static Future<ArtworkAutoMatchResult> matchMissingArtwork() async {
    final data = await ApiClient.post('/api/admin/catalog/artwork/auto-match') as Map<String, dynamic>;
    return ArtworkAutoMatchResult.fromJson(data);
  }

  static Future<void> saveFolderTitle(String folderId, String title) {
    return ApiClient.patch('/api/admin/catalog/folder/$folderId', {'title': title});
  }

  static Future<void> toggleFolderPublish(String folderId, {required bool publish}) {
    return ApiClient.post('/api/admin/catalog/folder/$folderId/${publish ? 'publish' : 'unpublish'}');
  }

  static Future<void> saveVideo(
    String fileId, {
    required String title,
    required List<String> subtitleSetIds,
    double? introStart,
    double? introEnd,
    double? outroStart,
  }) {
    return ApiClient.patch('/api/admin/catalog/video/$fileId', {
      'title': title,
      'subtitleSetIds': subtitleSetIds,
      'introStart': introStart,
      'introEnd': introEnd,
      'outroStart': outroStart,
    });
  }

  static Future<void> toggleVideoPublish(String fileId, {required bool publish}) {
    return ApiClient.post('/api/admin/catalog/video/$fileId/${publish ? 'publish' : 'unpublish'}');
  }

  static Future<void> generateRenditions(String fileId) {
    return ApiClient.post('/api/admin/catalog/video/$fileId/renditions');
  }

  static Future<String> uploadSubtitle(
    String fileId, {
    required String label,
    required String format,
    required String text,
  }) async {
    final path =
        '/api/admin/catalog/video/$fileId/subtitles?label=${Uri.encodeQueryComponent(label)}&format=$format';
    final data = await ApiClient.postText(path, text) as Map<String, dynamic>;
    return data['subtitleSetId'] as String;
  }

  /// Trashes the Drive file and removes the video from Campfire entirely (subtitles, progress,
  /// renditions, parties) — see the DELETE route in apps/backend/src/routes/admin/catalogVideo.ts.
  static Future<void> deleteVideo(String fileId) {
    return ApiClient.delete('/api/admin/catalog/video/$fileId');
  }

  static Future<ScanResult> runScan() async {
    final data = await ApiClient.post('/api/admin/scan') as Map<String, dynamic>;
    return ScanResult.fromJson(data);
  }
}
