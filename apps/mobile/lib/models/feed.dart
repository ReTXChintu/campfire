import 'media_request.dart';

/// Home's feed: all of TMDb in sections, made once a day server-side (apps/backend/src/lib/feed.ts),
/// and the titles For you suggests (lib/forYou.ts). Shapes mirror apps/frontend/src/lib/feed.ts.
/// Images are TMDb CDN URLs, loaded directly (no auth).

/// Any title on TMDb, in the library or not — one card in a feed row.
class TitleItem {
  final String tmdbType; // "movie" | "tv"
  final String tmdbId;
  final String title;
  final int? year;
  final double? rating;
  final List<String> genres;
  final String? overview;
  final String? posterUrl;
  final String? backdropUrl;

  /// The title's wordmark; only the hero's items have one.
  final String? logoUrl;

  /// Where the library has it, when it does.
  final CatalogRef? inLibrary;

  /// Why For you suggests it; null everywhere else.
  final String? reason;

  const TitleItem({
    required this.tmdbType,
    required this.tmdbId,
    required this.title,
    this.year,
    this.rating,
    this.genres = const [],
    this.overview,
    this.posterUrl,
    this.backdropUrl,
    this.logoUrl,
    this.inLibrary,
    this.reason,
  });

  bool get isSeries => tmdbType == 'tv';
  String get key => '$tmdbType-$tmdbId';
  String get kindLabel => isSeries ? 'Series' : 'Film';

  /// TMDb's own smaller cut of a backdrop: a card doesn't need the one that fills a screen.
  String? get smallBackdropUrl => backdropUrl?.replaceFirst('/w1280/', '/w780/');

  static TitleItem? tryParse(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    final type = json['tmdbType'];
    final id = json['tmdbId'];
    final title = json['title'];
    if ((type != 'movie' && type != 'tv') || id is! String || title is! String) return null;
    final lib = json['inLibrary'];
    return TitleItem(
      tmdbType: type as String,
      tmdbId: id,
      title: title,
      year: (json['year'] as num?)?.toInt(),
      rating: (json['rating'] as num?)?.toDouble(),
      genres: [for (final g in (json['genres'] as List? ?? const [])) if (g is String) g],
      overview: json['overview'] as String?,
      posterUrl: json['posterUrl'] as String?,
      backdropUrl: json['backdropUrl'] as String?,
      logoUrl: json['logoUrl'] as String?,
      inLibrary: lib is Map<String, dynamic> && lib['kind'] is String && lib['id'] is String ? CatalogRef.fromJson(lib) : null,
      reason: json['reason'] as String?,
    );
  }

  static List<TitleItem> listOf(Object? json) => [for (final e in (json as List? ?? const [])) ?TitleItem.tryParse(e)];
}

/// How a section's cards are drawn.
enum SectionLook { poster, wide, rank }

class FeedSection {
  final String id;
  final String title;
  final SectionLook look;
  final List<TitleItem> items;

  const FeedSection({required this.id, required this.title, required this.look, required this.items});

  FeedSection withItems(List<TitleItem> items) => FeedSection(id: id, title: title, look: look, items: items);

  static FeedSection? tryParse(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    final id = json['id'];
    final title = json['title'];
    if (id is! String || title is! String) return null;
    final look = switch (json['look']) {
      'wide' => SectionLook.wide,
      'rank' => SectionLook.rank,
      _ => SectionLook.poster,
    };
    return FeedSection(id: id, title: title, look: look, items: TitleItem.listOf(json['items']));
  }
}

/// `GET /api/feed?kind=…&page=…`.
class FeedPage {
  /// False when the server has no TMDb key: Home is the library alone.
  final bool available;
  final List<TitleItem> hero;
  final List<FeedSection> sections;
  final int? next;

  const FeedPage({required this.available, this.hero = const [], this.sections = const [], this.next});

  factory FeedPage.fromJson(Map<String, dynamic> json) => FeedPage(
        available: json['available'] == true,
        hero: TitleItem.listOf(json['hero']),
        sections: [for (final e in (json['sections'] as List? ?? const [])) ?FeedSection.tryParse(e)],
        next: (json['next'] as num?)?.toInt(),
      );
}

/// `GET /api/feed/section/:id?kind=…&page=…`.
class SectionPage {
  final String title;
  final List<TitleItem> items;
  final int? next;

  const SectionPage({required this.title, required this.items, this.next});

  factory SectionPage.fromJson(Map<String, dynamic> json) => SectionPage(
        title: json['title'] as String? ?? '',
        items: TitleItem.listOf(json['items']),
        next: (json['next'] as num?)?.toInt(),
      );
}

const _rowSize = 24;
const _minRow = 8;

/// Every section without what the ones above it already show, unless that leaves too little.
/// Same rule as the web's (apps/frontend/src/lib/feed.ts `withoutRepeats`).
List<FeedSection> withoutRepeats(List<FeedSection> sections) {
  final shown = <String>{};
  return [
    for (final section in sections)
      () {
        final fresh = section.items.where((i) => !shown.contains(i.key)).toList();
        final items = section.look == SectionLook.rank
            ? section.items
            : (fresh.length >= _minRow ? fresh : section.items).take(_rowSize).toList();
        shown.addAll(items.map((i) => i.key));
        return section.withItems(items);
      }(),
  ];
}

/// The library's titles For you picks, by kind and id; the client has their cards.
class ForYouLibraryPick {
  final String kind; // "folder" | "video"
  final String id;
  final String? reason;

  const ForYouLibraryPick({required this.kind, required this.id, this.reason});
}

/// `GET /api/opinions/for-you`.
class ForYou {
  /// False until the viewer has rated or watched enough to go on.
  final bool ready;
  final List<ForYouLibraryPick> library;
  final List<TitleItem> explore;

  const ForYou({this.ready = false, this.library = const [], this.explore = const []});

  factory ForYou.fromJson(Map<String, dynamic> json) => ForYou(
        ready: json['ready'] == true,
        library: [
          for (final e in (json['library'] as List? ?? const []))
            if (e is Map<String, dynamic> && e['kind'] is String && e['id'] is String)
              ForYouLibraryPick(kind: e['kind'] as String, id: e['id'] as String, reason: e['reason'] as String?),
        ],
        explore: TitleItem.listOf(json['explore']),
      );
}
