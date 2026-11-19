import '../models/explore.dart';
import 'api_client.dart';

/// Explore's three calls (apps/backend/src/routes/explore.ts). The backend caches TMDb's answers,
/// so these are cheap to repeat.
class ExploreApi {
  ExploreApi._();

  /// `kind` is "all", "movie" or "tv"; `services` are TMDb provider ids (at most three are used).
  static Future<ExploreWall> fetchWall({String kind = 'all', List<int> services = const []}) async {
    final query = <String, String>{
      'kind': kind,
      if (services.isNotEmpty) 'services': (List.of(services)..sort()).join(','),
    };
    final data = await ApiClient.get('/api/explore/wall?${Uri(queryParameters: query).query}') as Map<String, dynamic>;
    return ExploreWall.fromJson(data);
  }

  static Future<ExploreDetail> fetchTitle(String tmdbType, String tmdbId) async {
    final data = await ApiClient.get('/api/explore/title/$tmdbType/$tmdbId') as Map<String, dynamic>;
    return ExploreDetail.fromJson(data['title'] as Map<String, dynamic>);
  }
}
