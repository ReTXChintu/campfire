import '../models/catalog.dart';
import '../models/title_meta.dart';
import 'api_client.dart';

// Sentinel distinguishing "caller didn't pass this argument at all" from "caller explicitly
// passed null" — saveProgress needs the difference (null still means an intentional value: "off"
// for subtitleIndex/"no title" for audioTitle) but Dart has no built-in way to detect an omitted
// default value at the call site.
const Object unsetProgressField = Object();

/// A title watched by its TMDb id that the library has since added: watch it there instead.
class VideoMoved implements Exception {
  final String href;
  const VideoMoved(this.href);
}

class CatalogService {
  CatalogService._();

  static Future<LibraryResponse> fetchLibrary() async {
    final data = await ApiClient.get('/api/library?titles=1') as Map<String, dynamic>;
    return LibraryResponse.fromJson(data);
  }

  static Future<FolderResponse> fetchFolder(String folderId, {String? season}) async {
    final query = season != null ? '?season=${Uri.encodeQueryComponent(season)}' : '';
    final data = await ApiClient.get('/api/folder/$folderId$query') as Map<String, dynamic>;
    return FolderResponse.fromJson(data);
  }

  /// A library video, or a title by its own id ("tmdb:tv:1396:s1e2"), with a player for every
  /// source (`all=1`): whether one has it is asked when the viewer picks it. Throws [VideoMoved]
  /// for a title the library has added since.
  static Future<VideoResponse> fetchVideo(String fileId) async {
    final data = await ApiClient.get('/api/video/${Uri.encodeComponent(fileId)}?all=1') as Map<String, dynamic>;
    final moved = data['movedTo'];
    if (moved is String) throw VideoMoved(moved);
    return VideoResponse.fromJson(data);
  }

  /// The YouTube id of the title's official trailer, or null when there isn't one.
  static Future<String?> fetchTrailer(TmdbRef tmdb) async {
    final data = await ApiClient.get('/api/title/${tmdb.type}/${tmdb.id}/trailer') as Map<String, dynamic>;
    final trailer = data['trailer'];
    final id = trailer is Map<String, dynamic> ? trailer['youtubeId'] : null;
    return id is String ? id : null;
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
    Object? subtitleLanguage = unsetProgressField,
    Object? subtitleTitle = unsetProgressField,
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
    if (!identical(subtitleLanguage, unsetProgressField)) body['subtitleLanguage'] = subtitleLanguage;
    if (!identical(subtitleTitle, unsetProgressField)) body['subtitleTitle'] = subtitleTitle;
    if (!identical(audioLanguage, unsetProgressField)) body['audioLanguage'] = audioLanguage;
    if (!identical(audioTitle, unsetProgressField)) body['audioTitle'] = audioTitle;
    return ApiClient.post('/api/progress', body);
  }
}
