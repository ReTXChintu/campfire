import 'package:campfire_mobile/models/media_request.dart';
import 'package:flutter_test/flutter_test.dart';

// The request form's title search (`GET /api/requests/tmdb-search`, see
// apps/backend/src/lib/tmdbSearch.ts). Shapes below are what that endpoint sends.

Map<String, dynamic> _row(Map<String, dynamic> overrides) => {
  'tmdbType': 'movie',
  'tmdbId': '603',
  'title': 'The Matrix',
  'year': 1999,
  'overview': 'A hacker learns the truth.',
  'posterUrl': 'https://image.tmdb.org/t/p/w185/matrix.jpg',
  'link': 'https://www.themoviedb.org/movie/603',
  'inLibrary': null,
  'existingRequest': null,
  ...overrides,
};

void main() {
  group('TmdbSearchResult', () {
    test('parses a plain film result', () {
      final r = TmdbSearchResult.fromJson(_row({}));
      expect(r.tmdbType, 'movie');
      expect(r.tmdbId, '603');
      expect(r.title, 'The Matrix');
      expect(r.year, 1999);
      expect(r.overview, 'A hacker learns the truth.');
      expect(r.posterUrl, 'https://image.tmdb.org/t/p/w185/matrix.jpg');
      expect(r.link, 'https://www.themoviedb.org/movie/603');
      expect(r.isSeries, isFalse);
      expect(r.kindLabel, 'Film');
      expect(r.inLibrary, isNull);
      expect(r.libraryRoute, isNull);
      expect(r.existingRequest, isNull);
    });

    test('a series says so, and missing year/poster/overview stay null', () {
      final r = TmdbSearchResult.fromJson(_row({
        'tmdbType': 'tv',
        'tmdbId': '1399',
        'year': null,
        'overview': null,
        'posterUrl': null,
        'link': 'https://www.themoviedb.org/tv/1399',
      }));
      expect(r.isSeries, isTrue);
      expect(r.kindLabel, 'Series');
      expect(r.year, isNull);
      expect(r.overview, isNull);
      expect(r.posterUrl, isNull);
    });

    test('a numeric id is tolerated', () {
      expect(TmdbSearchResult.fromJson(_row({'tmdbId': 603})).tmdbId, '603');
    });

    test('already in the library routes to the folder or the player', () {
      final series = TmdbSearchResult.fromJson(_row({'inLibrary': {'kind': 'folder', 'id': 'f1'}}));
      expect(series.inLibrary, const CatalogRef(kind: 'folder', id: 'f1'));
      expect(series.libraryRoute, '/folder/f1');
      final film = TmdbSearchResult.fromJson(_row({'inLibrary': {'kind': 'video', 'id': 'v1'}}));
      expect(film.libraryRoute, '/watch/v1');
    });

    test('an existing open request carries its count, status and my vote', () {
      final r = TmdbSearchResult.fromJson(_row({
        'existingRequest': {'id': 'req-1', 'wantCount': 3, 'status': 'planned', 'iWantIt': true},
      }));
      final existing = r.existingRequest!;
      expect(existing.id, 'req-1');
      expect(existing.wantCount, 3);
      expect(existing.status, RequestStatus.planned);
      expect(existing.iWantIt, isTrue);
    });

    test('an existing request from an older backend without iWantIt defaults to not voted', () {
      final r = TmdbSearchResult.fromJson(_row({
        'existingRequest': {'id': 'req-2', 'wantCount': 1, 'status': 'new'},
      }));
      expect(r.existingRequest!.iWantIt, isFalse);
      expect(r.existingRequest!.status, RequestStatus.newRequest);
    });

    test('a pick becomes the same preview card a resolved link shows', () {
      final meta = TmdbSearchResult.fromJson(_row({'tmdbType': 'tv', 'tmdbId': '1399'})).toRefMeta();
      expect(meta.source, 'tmdb');
      expect(meta.sourceId, '1399');
      expect(meta.type, 'series');
      expect(meta.title, 'The Matrix');
      expect(meta.year, 1999);
      expect(meta.posterUrl, 'https://image.tmdb.org/t/p/w185/matrix.jpg');
    });
  });

  group('TmdbSearchResponse', () {
    test('parses results', () {
      final response = TmdbSearchResponse.fromJson({
        'available': true,
        'results': [_row({}), _row({'tmdbType': 'tv', 'tmdbId': '1'})],
      });
      expect(response.available, isTrue);
      expect(response.results, hasLength(2));
      expect(response.results[1].isSeries, isTrue);
    });

    test('no TMDb key on the server: unavailable, no results', () {
      final response = TmdbSearchResponse.fromJson({'available': false, 'results': []});
      expect(response.available, isFalse);
      expect(response.results, isEmpty);
    });

    test('a missing available flag is treated as search being off', () {
      expect(TmdbSearchResponse.fromJson({}).available, isFalse);
      expect(TmdbSearchResponse.fromJson({}).results, isEmpty);
    });

    test('a row without a title is dropped rather than rendered blank', () {
      final response = TmdbSearchResponse.fromJson({
        'available': true,
        'results': [_row({'title': ''}), _row({})],
      });
      expect(response.results, hasLength(1));
    });
  });
}
