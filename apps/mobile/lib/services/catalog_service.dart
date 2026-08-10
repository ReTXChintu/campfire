import '../models/catalog.dart';
import 'api_client.dart';

class CatalogService {
  CatalogService._();

  static Future<LibraryResponse> fetchLibrary() async {
    final data = await ApiClient.get('/api/library') as Map<String, dynamic>;
    return LibraryResponse.fromJson(data);
  }

  static Future<FolderResponse> fetchFolder(String folderId, {String? season}) async {
    final query = season != null ? '?season=${Uri.encodeQueryComponent(season)}' : '';
    final data = await ApiClient.get('/api/folder/$folderId$query') as Map<String, dynamic>;
    return FolderResponse.fromJson(data);
  }

  static Future<VideoResponse> fetchVideo(String fileId) async {
    final data = await ApiClient.get('/api/video/$fileId') as Map<String, dynamic>;
    return VideoResponse.fromJson(data);
  }

  static Future<ProbeResult> fetchProbe(String fileId) async {
    final data = await ApiClient.get('/api/probe/$fileId') as Map<String, dynamic>;
    return ProbeResult.fromJson(data);
  }

  static Future<void> saveProgress({
    required String fileId,
    required String parentFolderId,
    required double positionSeconds,
    required double durationSeconds,
  }) {
    return ApiClient.post('/api/progress', {
      'fileId': fileId,
      'parentFolderId': parentFolderId,
      'positionSeconds': positionSeconds,
      'durationSeconds': durationSeconds,
    });
  }
}
