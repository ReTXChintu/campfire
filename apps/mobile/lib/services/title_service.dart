import '../models/feed.dart';
import '../models/play.dart';
import 'api_client.dart';

/// Titles by their TMDb id, Home's feed and the sources a viewer plays from (backend
/// routes/feed.ts, routes/title.ts, routes/sources.ts, routes/sourceStream.ts).
class TitleService {
  TitleService._();

  /// `kind` is "all", "movie" or "tv"; pages start at 0.
  static Future<FeedPage> fetchFeed({String kind = 'all', int page = 0}) async {
    final data = await ApiClient.get('/api/feed?kind=$kind&page=$page') as Map<String, dynamic>;
    return FeedPage.fromJson(data);
  }

  /// One section as an endless grid; pages start at 1.
  static Future<SectionPage> fetchSection(String id, {String kind = 'all', int page = 1}) async {
    final data = await ApiClient.get('/api/feed/section/${Uri.encodeComponent(id)}?kind=$kind&page=$page')
        as Map<String, dynamic>;
    return SectionPage.fromJson(data);
  }

  static Future<List<TitleItem>> fetchSimilar(String type, String id) async {
    final data = await ApiClient.get('/api/explore/title/$type/$id/similar') as Map<String, dynamic>;
    return TitleItem.listOf(data['items']);
  }

  static List<ViewerSource>? _sources;
  static DateTime _sourcesAt = DateTime.fromMillisecondsSinceEpoch(0);

  /// The sources added in admin, in its order. Kept a minute.
  static Future<List<ViewerSource>> fetchSources() async {
    final cached = _sources;
    if (cached != null && DateTime.now().difference(_sourcesAt) < const Duration(minutes: 1)) return cached;
    final data = await ApiClient.get('/api/sources') as Map<String, dynamic>;
    _sourcesAt = DateTime.now();
    return _sources = ViewerSource.listOf(data['sources']);
  }

  /// Where Play goes for a title: the library's own page for it, or the title's
  /// (`/watch/tmdb:movie:603`). A series without an episode carries on where the viewer stopped.
  static Future<String> playTarget(String type, String id, {int? season, int? episode}) async {
    final query = season != null && episode != null ? '?season=$season&episode=$episode' : '';
    final data = await ApiClient.get('/api/title/$type/$id/play$query') as Map<String, dynamic>;
    return data['href'] as String;
  }

  /// A season of a series with the viewer's progress; the one they're in when [season] is null.
  static Future<SeriesEpisodes> fetchEpisodes(String seriesId, {int? season}) async {
    final query = season == null ? '' : '?season=$season';
    final data = await ApiClient.get('/api/title/tv/$seriesId/episodes$query') as Map<String, dynamic>;
    return SeriesEpisodes.fromJson(data);
  }

  /// The HLS address a video plays from in one hosted source. Throws (404) when it isn't there.
  static Future<SourceStream> fetchSourceStream(String sourceId, String fileId) async {
    final data = await ApiClient.get('/api/source-stream/${Uri.encodeComponent(sourceId)}/${Uri.encodeComponent(fileId)}')
        as Map<String, dynamic>;
    return SourceStream.fromJson(data);
  }
}
