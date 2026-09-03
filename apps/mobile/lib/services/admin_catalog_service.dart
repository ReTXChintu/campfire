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

  static Future<ScanResult> runScan() async {
    final data = await ApiClient.post('/api/admin/scan') as Map<String, dynamic>;
    return ScanResult.fromJson(data);
  }
}
