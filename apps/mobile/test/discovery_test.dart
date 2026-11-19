import 'package:campfire_mobile/models/catalog.dart';
import 'package:campfire_mobile/models/discovery.dart';
import 'package:campfire_mobile/models/title_meta.dart';
import 'package:flutter_test/flutter_test.dart';

// Mirrors the checks run against apps/frontend/src/lib/discovery.ts, so search, Discover and Home
// behave the same in the apps as on the web.

const _hotd = CatalogFolderItem(
  id: 'h',
  name: 'House of the Dragon',
  thumbnailFileId: 'tmdb',
  year: 2022,
  rating: TmdbRating(average: 8.4, count: 1),
  genres: ['Drama', 'Sci-Fi & Fantasy'],
  castNames: ['Matt Smith', "Emma D'Arcy"],
);
const _weapons = CatalogVideoItem(
  id: 'w',
  name: 'Weapons',
  mimeType: 'video/mp4',
  year: 2025,
  rating: TmdbRating(average: 7.3, count: 1),
  genres: ['Horror', 'Mystery'],
  castNames: ['Julia Garner'],
);
const _gargi = CatalogVideoItem(
  id: 'g',
  name: 'Gargi',
  mimeType: 'video/mp4',
  year: 2022,
  rating: TmdbRating(average: 7.5, count: 1),
  genres: ['Drama'],
  castNames: ['Sai Pallavi'],
);
const _unmatched = CatalogVideoItem(id: 'u', name: 'Home Video', mimeType: 'video/mp4');

List<String> _ids(List<CatalogListItem> items) => items.map((i) => i.id).toList();

void main() {
  group('search', () {
    test('a title match', () => expect(matchItem(_hotd, 'dragon'), isA<TitleMatch>()));

    test('an actor finds the show, and says so', () {
      expect(reasonLabel(matchItem(_hotd, 'matt smith')), 'With Matt Smith');
    });

    test('a genre finds the show', () => expect(reasonLabel(matchItem(_weapons, 'horror')), 'Horror'));

    test('words can come from different fields', () {
      expect(matchItem(_hotd, 'smith dragon'), isA<CastMatch>());
    });

    test('every word has to match somewhere', () => expect(matchItem(_hotd, 'smith garner'), isNull));

    test('case and accents do not matter', () {
      expect(matchItem(_gargi, 'SAI pallavi'), isA<CastMatch>());
      const zoe = CatalogVideoItem(id: 'z', name: 'X', mimeType: 'video/mp4', castNames: ['Zoë Kravitz']);
      expect(matchItem(zoe, 'zoe'), isA<CastMatch>());
    });

    test('an unmatched title is still found by its name, and only that', () {
      expect(matchItem(_unmatched, 'home'), isA<TitleMatch>());
      expect(matchItem(_unmatched, 'drama'), isNull);
    });

    test('a title match shows no reason line', () => expect(reasonLabel(matchItem(_hotd, 'house')), isNull));
  });

  group('genre rows', () {
    test('a genre needs two titles to get a row', () {
      final shelves = genreShelves([_hotd, _weapons, _gargi, _unmatched]);
      expect(shelves.map((s) => s.genre), ['Drama']);
      expect(_ids(shelves.single.items), ['h', 'g'], reason: 'best rated first');
    });

    test('rows are capped', () {
      expect(genreShelves([_hotd, _weapons, _gargi], min: 1, max: 2), hasLength(2));
    });

    test('every genre present, alphabetically, for the chips', () {
      expect(allGenres([_hotd, _weapons, _gargi]), ['Drama', 'Horror', 'Mystery', 'Sci-Fi & Fantasy']);
    });
  });

  group('sorting', () {
    test('highest rated, with unrated titles last', () {
      expect(_ids(sortItems([_unmatched, _weapons, _hotd, _gargi], SortKey.rating)), ['h', 'g', 'w', 'u']);
    });

    test('newest, undated last, ties A–Z', () {
      expect(_ids(sortItems([_unmatched, _gargi, _hotd, _weapons], SortKey.newest)), ['w', 'g', 'h', 'u']);
    });

    test('a parsed filename year stands in for a title TMDb does not know', () {
      expect(
        _ids(sortItems([_gargi, _unmatched], SortKey.newest, yearOf: (i) => i.id == 'u' ? 2030 : null)),
        ['u', 'g'],
      );
    });

    test('library order is left alone', () {
      expect(_ids(sortItems([_weapons, _gargi, _hotd], SortKey.library)), ['w', 'g', 'h']);
    });
  });

  test('list items carry genres and lead actors, and an older backend parses to empty lists', () {
    final item = CatalogListItem.fromJson({
      'kind': 'folder',
      'id': 'h',
      'name': 'House of the Dragon',
      'thumbnailFileId': 'tmdb',
      'genres': ['Drama'],
      'castNames': ['Matt Smith'],
    });
    expect(item.genres, ['Drama']);
    expect(item.castNames, ['Matt Smith']);
    final older = CatalogListItem.fromJson({'kind': 'video', 'id': 'v', 'name': 'x', 'mimeType': 'video/mp4'});
    expect(older.genres, isEmpty);
    expect(older.castNames, isEmpty);
  });
}
