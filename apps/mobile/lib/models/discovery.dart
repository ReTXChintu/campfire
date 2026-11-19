import 'catalog.dart';

// Mirrors apps/frontend/src/lib/discovery.ts: one place for how the library is searched, grouped
// and sorted, so search, Discover and Home's genre rows can never disagree about what matches.
// Everything runs over the library listing already in memory — there is no search endpoint.

/// Why an item matched a search. Shown under the result, because "Matt Smith" finding House of the
/// Dragon looks like a bug unless it says so.
sealed class MatchReason {
  const MatchReason();
}

class TitleMatch extends MatchReason {
  const TitleMatch();
}

class GenreMatch extends MatchReason {
  final String genre;
  const GenreMatch(this.genre);
}

class CastMatch extends MatchReason {
  final String name;
  const CastMatch(this.name);
}

/// Lower-case, with the accents taken off, so "zoe" finds "Zoë".
String _fold(String value) {
  const accents = {
    'à': 'a', 'á': 'a', 'â': 'a', 'ä': 'a', 'ã': 'a', 'å': 'a',
    'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e',
    'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i',
    'ò': 'o', 'ó': 'o', 'ô': 'o', 'ö': 'o', 'õ': 'o',
    'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u',
    'ñ': 'n', 'ç': 'c', 'ý': 'y', 'ÿ': 'y',
  };
  final lower = value.toLowerCase();
  final out = StringBuffer();
  for (final rune in lower.runes) {
    final char = String.fromCharCode(rune);
    out.write(accents[char] ?? char);
  }
  return out.toString();
}

/// Whether an item matches what was typed, and on what. Every word has to appear somewhere — in
/// the title, a genre or an actor's name — so "smith dragon" finds House of the Dragon through two
/// different fields. A title match wins; otherwise a person, the more surprising thing to show.
MatchReason? matchItem(CatalogListItem item, String query) {
  final words = _fold(query).split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
  if (words.isEmpty) return const TitleMatch();

  final title = _fold(item.name);
  final haystack = [title, ...item.genres.map(_fold), ...item.castNames.map(_fold)].join(' \u0000 ');
  if (!words.every(haystack.contains)) return null;

  if (words.every(title.contains)) return const TitleMatch();
  for (final name in item.castNames) {
    if (words.any(_fold(name).contains)) return CastMatch(name);
  }
  for (final genre in item.genres) {
    if (words.any(_fold(genre).contains)) return GenreMatch(genre);
  }
  return const TitleMatch();
}

/// The line under a search result explaining a non-title match.
String? reasonLabel(MatchReason? reason) => switch (reason) {
  CastMatch(:final name) => 'With $name',
  GenreMatch(:final genre) => genre,
  _ => null,
};

enum SortKey { library, az, za, rating, newest }

/// Sorts a copy. A title without the value being sorted on (an unmatched one has no score and no
/// year) goes last rather than first, then A–Z so the order is stable. [yearOf] lets a caller fall
/// back to a year parsed from the name for titles TMDb doesn't know.
List<T> sortItems<T extends CatalogListItem>(
  List<T> items,
  SortKey key, {
  int? Function(T item)? yearOf,
}) {
  final sorted = [...items];
  int byName(T a, T b) => a.name.toLowerCase().compareTo(b.name.toLowerCase());
  switch (key) {
    case SortKey.library:
      return sorted;
    case SortKey.az:
      sorted.sort(byName);
    case SortKey.za:
      sorted.sort((a, b) => byName(b, a));
    case SortKey.rating:
      sorted.sort((a, b) {
        final c = (b.rating?.average ?? -1).compareTo(a.rating?.average ?? -1);
        return c != 0 ? c : byName(a, b);
      });
    case SortKey.newest:
      sorted.sort((a, b) {
        final c = ((yearOf?.call(b) ?? b.year) ?? -1).compareTo((yearOf?.call(a) ?? a.year) ?? -1);
        return c != 0 ? c : byName(a, b);
      });
  }
  return sorted;
}

/// The genres worth a row of their own, most-stocked first: only those with at least [min]
/// titles (a one-title row is just a card with a heading), and at most [max], so Home stays a
/// front page rather than an index. Each row is best rated first.
List<({String genre, List<CatalogListItem> items})> genreShelves(
  List<CatalogListItem> items, {
  int min = 2,
  int max = 3,
}) {
  final byGenre = <String, List<CatalogListItem>>{};
  for (final item in items) {
    for (final genre in item.genres) {
      byGenre.putIfAbsent(genre, () => []).add(item);
    }
  }
  final shelves = byGenre.entries.where((e) => e.value.length >= min).toList()
    ..sort((a, b) {
      final c = b.value.length.compareTo(a.value.length);
      return c != 0 ? c : a.key.compareTo(b.key);
    });
  return [
    for (final entry in shelves.take(max)) (genre: entry.key, items: sortItems(entry.value, SortKey.rating)),
  ];
}

/// Every genre present, alphabetically — Discover's genre chips.
List<String> allGenres(List<CatalogListItem> items) =>
    ({for (final item in items) ...item.genres}.toList()..sort());
