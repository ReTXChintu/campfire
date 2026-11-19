import 'media_request.dart';

/// Explore — all of TMDb, not just the library, and where each title streams in India. Shapes
/// mirror apps/backend/src/lib/explore.ts. Images are TMDb CDN URLs, loaded directly (no auth).

/// One poster on the fisheye wall (`GET /api/explore/wall`).
class WallItem {
  final String tmdbType; // "movie" | "tv"
  final String tmdbId;
  final String title;
  final int? year;
  final double? rating;
  final List<String> genres;
  final String posterPath;
  final bool inCampfire;

  const WallItem({
    required this.tmdbType,
    required this.tmdbId,
    required this.title,
    this.year,
    this.rating,
    this.genres = const [],
    required this.posterPath,
    this.inCampfire = false,
  });

  bool get isSeries => tmdbType == 'tv';
  String get key => '$tmdbType-$tmdbId';

  static WallItem? tryParse(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    final type = json['tmdbType'];
    final id = json['tmdbId'];
    final title = json['title'];
    final poster = json['posterPath'];
    if ((type != 'movie' && type != 'tv') || id is! String || title is! String || poster is! String) return null;
    return WallItem(
      tmdbType: type as String,
      tmdbId: id,
      title: title,
      year: (json['year'] as num?)?.toInt(),
      rating: (json['rating'] as num?)?.toDouble(),
      genres: [for (final g in (json['genres'] as List? ?? const [])) if (g is String) g],
      posterPath: poster,
      inCampfire: json['inCampfire'] == true,
    );
  }
}

class ExploreService {
  final int id;
  final String name;
  final String? logoUrl;

  const ExploreService({required this.id, required this.name, this.logoUrl});

  static ExploreService? tryParse(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    final id = (json['id'] as num?)?.toInt();
    final name = json['name'];
    if (id == null || name is! String) return null;
    return ExploreService(id: id, name: name, logoUrl: json['logoUrl'] as String?);
  }
}

class ExploreWall {
  /// False when the server has no TMDb key: Explore isn't set up there.
  final bool available;
  final List<WallItem> items;
  final List<ExploreService> services;
  final String? imageBase;

  const ExploreWall({required this.available, this.items = const [], this.services = const [], this.imageBase});

  factory ExploreWall.fromJson(Map<String, dynamic> json) => ExploreWall(
        available: json['available'] == true,
        items: [for (final e in (json['items'] as List? ?? const [])) ?WallItem.tryParse(e)],
        services: [for (final e in (json['services'] as List? ?? const [])) ?ExploreService.tryParse(e)],
        imageBase: json['imageBase'] as String?,
      );
}

/// Somewhere to watch it: the service, and where "Open" goes.
class ExploreOffer {
  final int id;
  final String name;
  final String? logoUrl;
  final String url;

  const ExploreOffer({required this.id, required this.name, this.logoUrl, required this.url});

  static ExploreOffer? tryParse(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    final id = (json['id'] as num?)?.toInt();
    final name = json['name'];
    final url = json['url'];
    if (id == null || name is! String || url is! String) return null;
    return ExploreOffer(id: id, name: name, logoUrl: json['logoUrl'] as String?, url: url);
  }
}

class ExploreCastMember {
  final String name;
  final String? character;
  final String? profileUrl;

  const ExploreCastMember({required this.name, this.character, this.profileUrl});
}

/// One title opened (`GET /api/explore/title/:type/:id`).
class ExploreDetail {
  final String tmdbType;
  final String tmdbId;
  final String title;
  final int? year;
  final double? rating;
  final List<String> genres;
  final String? overview;
  final String? posterUrl;
  final String? backdropUrl;
  final String? tagline;
  final int? runtime;
  final int? seasons;
  final List<ExploreCastMember> cast;
  final String link;
  final String? watchLink;
  final List<ExploreOffer> stream;
  final List<ExploreOffer> free;
  final List<ExploreOffer> rentBuy;
  final CatalogRef? inLibrary;
  final TmdbExistingRequest? existingRequest;

  const ExploreDetail({
    required this.tmdbType,
    required this.tmdbId,
    required this.title,
    this.year,
    this.rating,
    this.genres = const [],
    this.overview,
    this.posterUrl,
    this.backdropUrl,
    this.tagline,
    this.runtime,
    this.seasons,
    this.cast = const [],
    required this.link,
    this.watchLink,
    this.stream = const [],
    this.free = const [],
    this.rentBuy = const [],
    this.inLibrary,
    this.existingRequest,
  });

  bool get isSeries => tmdbType == 'tv';
  bool get streamsNowhere => stream.isEmpty && free.isEmpty && rentBuy.isEmpty;

  /// Where "Play in Campfire" goes; null when it isn't in the library.
  String? get libraryRoute {
    final ref = inLibrary;
    if (ref == null) return null;
    return ref.kind == 'folder' ? '/folder/${ref.id}' : '/watch/${ref.id}';
  }

  /// "2022 · Series · 3 seasons" / "2010 · Film · 2h 28m".
  String get metaLine {
    final parts = <String>[if (year != null) '$year', isSeries ? 'Series' : 'Film'];
    if (isSeries && seasons != null && seasons! > 0) parts.add('$seasons season${seasons == 1 ? '' : 's'}');
    final minutes = runtime;
    if (!isSeries && minutes != null && minutes > 0) {
      final h = minutes ~/ 60;
      final m = minutes % 60;
      parts.add(h > 0 ? '${h}h${m > 0 ? ' ${m}m' : ''}' : '${m}m');
    }
    return parts.join(' · ');
  }

  factory ExploreDetail.fromJson(Map<String, dynamic> json) {
    final watch = json['watch'] is Map<String, dynamic> ? json['watch'] as Map<String, dynamic> : const <String, dynamic>{};
    List<ExploreOffer> offers(String key) => [for (final e in (watch[key] as List? ?? const [])) ?ExploreOffer.tryParse(e)];
    final lib = json['inLibrary'];
    final req = json['existingRequest'];
    return ExploreDetail(
      tmdbType: json['tmdbType'] as String,
      tmdbId: json['tmdbId'] as String,
      title: json['title'] as String,
      year: (json['year'] as num?)?.toInt(),
      rating: (json['rating'] as num?)?.toDouble(),
      genres: [for (final g in (json['genres'] as List? ?? const [])) if (g is String) g],
      overview: json['overview'] as String?,
      posterUrl: json['posterUrl'] as String?,
      backdropUrl: json['backdropUrl'] as String?,
      tagline: json['tagline'] as String?,
      runtime: (json['runtime'] as num?)?.toInt(),
      seasons: (json['seasons'] as num?)?.toInt(),
      cast: [
        for (final c in (json['cast'] as List? ?? const []))
          if (c is Map<String, dynamic> && c['name'] is String)
            ExploreCastMember(name: c['name'] as String, character: c['character'] as String?, profileUrl: c['profileUrl'] as String?),
      ],
      link: json['link'] as String,
      watchLink: watch['link'] as String?,
      stream: offers('stream'),
      free: offers('free'),
      rentBuy: offers('rentBuy'),
      inLibrary: lib is Map<String, dynamic> ? CatalogRef.fromJson(lib) : null,
      existingRequest: req is Map<String, dynamic> ? TmdbExistingRequest.fromJson(req) : null,
    );
  }
}
