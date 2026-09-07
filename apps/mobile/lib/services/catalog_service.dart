import '../models/catalog.dart';
import 'api_client.dart';

// Sentinel distinguishing "caller didn't pass this argument at all" from "caller explicitly
// passed null" — saveProgress needs the difference (null still means an intentional value: "off"
// for subtitleIndex/"no title" for audioTitle) but Dart has no built-in way to detect an omitted
// default value at the call site.
const Object unsetProgressField = Object();

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
    // Omitted (not just null) fields are left untouched server-side — only pass these when this
    // save actually has something to say about tracks (see apps/backend/src/lib/progress.ts).
    String? subtitleSource,
    Object? subtitleIndex = unsetProgressField,
    Object? audioLanguage = unsetProgressField,
    Object? audioTitle = unsetProgressField,
  }) {
    final body = <String, dynamic>{
      'fileId': fileId,
      'parentFolderId': parentFolderId,
      'positionSeconds': positionSeconds,
      'durationSeconds': durationSeconds,
    };
    if (subtitleSource != null) body['subtitleSource'] = subtitleSource;
    if (!identical(subtitleIndex, unsetProgressField)) body['subtitleIndex'] = subtitleIndex;
    if (!identical(audioLanguage, unsetProgressField)) body['audioLanguage'] = audioLanguage;
    if (!identical(audioTitle, unsetProgressField)) body['audioTitle'] = audioTitle;
    return ApiClient.post('/api/progress', body);
  }
}
