// Mirrors apps/backend/src/lib/catalogMeta.ts and apps/frontend/src/lib/types.ts — the TMDb facts
// every viewer-facing detail response carries. Every field is nullable or empty by default: an
// unmatched title, or a backend older than this, simply yields fewer facts and the screens show
// less rather than breaking.

/// TMDb's own user score. Not IMDb's — TMDb doesn't publish those.
class TmdbRating {
  final double average;
  final int count;

  const TmdbRating({required this.average, required this.count});

  static TmdbRating? tryParse(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    final average = (json['average'] as num?)?.toDouble();
    if (average == null || average <= 0) return null;
    return TmdbRating(average: average, count: (json['count'] as num?)?.toInt() ?? 0);
  }

  /// One decimal place, which is how TMDb itself writes it.
  String get label => average.toStringAsFixed(1);
}

/// Which TMDb title something is — a title's identity (backend lib/tmdbRef.ts).
class TmdbRef {
  final String type; // "movie" | "tv"
  final String id;

  const TmdbRef({required this.type, required this.id});

  static TmdbRef? tryParse(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    final type = json['type'];
    final id = json['id'];
    if ((type != 'movie' && type != 'tv') || id is! String) return null;
    return TmdbRef(type: type as String, id: id);
  }
}

class CastMember {
  final String name;
  final String? character;

  /// A Bearer-gated backend path, so it loads through AuthedNetworkImage — never a bare URL.
  final String? imagePath;

  const CastMember({required this.name, this.character, this.imagePath});

  factory CastMember.fromJson(Map<String, dynamic> json) => CastMember(
    name: json['name'] as String? ?? '',
    character: json['character'] as String?,
    imagePath: json['imagePath'] as String?,
  );
}

class TitleMeta {
  /// Null when the title isn't matched, or from an older backend.
  final TmdbRef? tmdb;
  final int? year;
  final String? overview;
  final String? tagline;

  /// A film's length, or a series' typical episode length.
  final int? runtimeMinutes;
  final List<String> genres;

  /// The age rating as its board writes it: "U/A 16+", "PG-13".
  final String? certificate;
  final TmdbRating? rating;

  /// The title has a wordmark: load it from its thumbnail path with `?shape=logo`.
  final bool hasLogo;
  final int? seasonCount;
  final int? episodeCount;
  final List<CastMember> cast;

  const TitleMeta({
    this.tmdb,
    this.year,
    this.overview,
    this.tagline,
    this.runtimeMinutes,
    this.genres = const [],
    this.certificate,
    this.rating,
    this.hasLogo = false,
    this.seasonCount,
    this.episodeCount,
    this.cast = const [],
  });

  /// Reads the facts straight off a detail response, which carries them flattened rather than
  /// nested — so this takes the whole response body.
  factory TitleMeta.fromJson(Map<String, dynamic> json) => TitleMeta(
    tmdb: TmdbRef.tryParse(json['tmdb']),
    year: (json['year'] as num?)?.toInt(),
    overview: json['overview'] as String?,
    tagline: json['tagline'] as String?,
    runtimeMinutes: (json['runtimeMinutes'] as num?)?.toInt(),
    genres: (json['genres'] as List?)?.whereType<String>().toList() ?? const [],
    certificate: json['certificate'] as String?,
    rating: TmdbRating.tryParse(json['rating']),
    hasLogo: json['hasLogo'] as bool? ?? false,
    seasonCount: (json['seasonCount'] as num?)?.toInt(),
    episodeCount: (json['episodeCount'] as num?)?.toInt(),
    cast:
        (json['cast'] as List?)
            ?.whereType<Map<String, dynamic>>()
            .map(CastMember.fromJson)
            .where((c) => c.name.isNotEmpty)
            .toList() ??
        const [],
  );

  /// True when there is nothing to show — the title isn't matched, so a facts line would be an
  /// empty row and a cast section an empty heading.
  bool get isEmpty =>
      year == null &&
      overview == null &&
      tagline == null &&
      runtimeMinutes == null &&
      genres.isEmpty &&
      certificate == null &&
      rating == null &&
      cast.isEmpty;
}

/// Which episode a video is, when it belongs to a matched series.
class EpisodeMeta {
  final int? number;
  final int? season;
  final String? overview;
  final String? airDate;
  final int? runtimeMinutes;
  final TmdbRating? rating;

  const EpisodeMeta({
    this.number,
    this.season,
    this.overview,
    this.airDate,
    this.runtimeMinutes,
    this.rating,
  });

  static EpisodeMeta? tryParse(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    return EpisodeMeta(
      number: (json['number'] as num?)?.toInt(),
      season: (json['season'] as num?)?.toInt(),
      overview: json['overview'] as String?,
      airDate: json['airDate'] as String?,
      runtimeMinutes: (json['runtimeMinutes'] as num?)?.toInt(),
      rating: TmdbRating.tryParse(json['rating']),
    );
  }

  /// "S1 E4", or "E4" when the season isn't known. Null when there is no number to show.
  String? get label {
    if (number == null) return null;
    return (season != null && season! > 0) ? 'S$season E$number' : 'E$number';
  }
}

/// A runtime in minutes as people say it: "2h 8m", "47m". Null for anything missing.
String? runtimeLabel(int? minutes) {
  if (minutes == null || minutes <= 0) return null;
  final hours = minutes ~/ 60;
  final rest = minutes % 60;
  if (hours == 0) return '${rest}m';
  return rest == 0 ? '${hours}h' : '${hours}h ${rest}m';
}

/// An air date as "4 Sep 2022", or null when it isn't a usable date.
String? airDateLabel(String? airDate) {
  if (airDate == null || airDate.isEmpty) return null;
  final parsed = DateTime.tryParse(airDate);
  if (parsed == null) return null;
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return '${parsed.day} ${months[parsed.month - 1]} ${parsed.year}';
}
