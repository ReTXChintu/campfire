import 'package:campfire_mobile/models/admin_catalog.dart';
import 'package:campfire_mobile/models/catalog.dart';
import 'package:campfire_mobile/models/title_meta.dart';
import 'package:campfire_mobile/widgets/title_meta_views.dart';
import 'package:campfire_mobile/widgets/admin/admin_artwork_panel.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _artworkJson = {
  'source': 'auto',
  'tmdbType': 'tv',
  'tmdbId': '94997',
  'title': 'House of the Dragon',
  'year': 2022,
  'overview': 'The reign of House Targaryen begins with this story set 200 years before Game of Thrones. '
      'It follows the civil war that came to be known as the Dance of the Dragons.',
  'backdropPath': '/abc.jpg',
  'posterPath': null,
  'matchedAt': '2026-11-15T10:00:00.000Z',
  'tagline': 'All must choose.',
  'runtimeMinutes': 60,
  'genres': ['Drama', 'Fantasy'],
  'certificate': 'A',
  'rating': {'average': 8.4, 'count': 5000},
  'logoPath': '/hotdLogo.png',
  'seasonCount': 2,
  'cast': [
    {'name': 'Matt Smith', 'character': 'Daemon Targaryen', 'profilePath': '/smith.jpg'},
  ],
};

Widget _host(double width, Widget child) => MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(child: SizedBox(width: width, child: child)),
      ),
    );

void main() {
  group('parsing', () {
    test('series page carries the TMDb facts, and tolerates an older backend without them', () {
      final base = {'mode': 'series', 'folderId': 'f', 'title': 'HOTD', 'backHref': '/', 'thumbnailFileId': 'tmdb'};
      final withMeta = FolderResponse.fromJson({
        ...base,
        'year': 2022,
        'overview': 'Dragons.',
        'tagline': 'All must choose.',
        'runtimeMinutes': 60,
        'genres': ['Drama', 'Fantasy'],
        'certificate': 'A',
        'rating': {'average': 8.4, 'count': 5000},
        'hasLogo': true,
        'seasonCount': 2,
        'cast': [
          {'name': 'Matt Smith', 'character': 'Daemon Targaryen', 'imagePath': '/api/cast-image/folder/f/0'},
          {'name': 'Nobody Pictured', 'character': null, 'imagePath': null},
        ],
      });
      expect(withMeta.meta.year, 2022);
      expect(withMeta.meta.overview, 'Dragons.');
      expect(withMeta.meta.tagline, 'All must choose.');
      expect(withMeta.meta.runtimeMinutes, 60);
      expect(withMeta.meta.genres, ['Drama', 'Fantasy']);
      expect(withMeta.meta.certificate, 'A');
      expect(withMeta.meta.rating?.label, '8.4');
      expect(withMeta.meta.hasLogo, isTrue);
      expect(withMeta.meta.cast.first.character, 'Daemon Targaryen');
      expect(withMeta.meta.cast.last.imagePath, isNull);
      expect(withMeta.meta.isEmpty, isFalse);

      final older = FolderResponse.fromJson(base);
      expect(older.meta.year, isNull);
      expect(older.meta.overview, isNull);
      expect(older.meta.genres, isEmpty);
      expect(older.meta.cast, isEmpty);
      expect(older.meta.hasLogo, isFalse);
      expect(older.meta.isEmpty, isTrue, reason: 'an unmatched title must render no facts line');
    });

    test('a score nobody voted on, or of zero, is not a score', () {
      expect(TmdbRating.tryParse({'average': 0, 'count': 0}), isNull);
      expect(TmdbRating.tryParse(null), isNull);
      expect(TmdbRating.tryParse({'average': 7.45, 'count': 12})?.label, '7.5');
    });

    test('episode rows carry the TMDb number and synopsis, not just a name', () {
      final row = CatalogListItem.fromJson({
        'kind': 'video',
        'id': 'v',
        'name': 'The Heirs of the Dragon',
        'mimeType': 'video/x-matroska',
        'episodeNumber': 1,
        'overview': 'Viserys hosts a tourney.',
        'runtimeMinutes': 66,
        'rating': {'average': 8.1, 'count': 400},
      }) as CatalogVideoItem;
      expect(row.episodeNumber, 1);
      expect(row.overview, 'Viserys hosts a tourney.');
      expect(row.runtimeMinutes, 66);
      expect(row.rating?.label, '8.1');

      final plain = CatalogListItem.fromJson({'kind': 'video', 'id': 'v', 'name': 'x', 'mimeType': 'video/mp4'});
      expect((plain as CatalogVideoItem).episodeNumber, isNull);
      expect(plain.rating, isNull);
    });

    test('the player knows which episode it is; a film has no episode block', () {
      final episode = EpisodeMeta.tryParse({
        'number': 4,
        'season': 1,
        'overview': 'Rhaenyra sees the city.',
        'airDate': '2022-09-11',
        'runtimeMinutes': 64,
        'rating': {'average': 8.0, 'count': 300},
      });
      expect(episode?.label, 'S1 E4');
      expect(episode?.overview, 'Rhaenyra sees the city.');
      expect(EpisodeMeta.tryParse(null), isNull);
      // Specials are season 0, where "S0 E2" would be noise.
      expect(const EpisodeMeta(season: 0, number: 2).label, 'E2');
      expect(const EpisodeMeta(season: 1).label, isNull);
    });

    test('runtimes and air dates read the way people say them', () {
      expect(runtimeLabel(128), '2h 8m');
      expect(runtimeLabel(120), '2h');
      expect(runtimeLabel(47), '47m');
      expect(runtimeLabel(0), isNull);
      expect(runtimeLabel(null), isNull);
      expect(airDateLabel('2022-09-04'), '4 Sep 2022');
      expect(airDateLabel('not a date'), isNull);
      expect(airDateLabel(null), isNull);
    });

    test('a spotlight slide carries a wordmark when there is one', () {
      final base = {'id': 's', 'title': 'Weapons', 'playHref': '/watch/v'};
      expect(SpotlightSlide.fromJson({...base, 'logoPath': '/api/thumbnail/v?shape=logo'}).logoPath,
          '/api/thumbnail/v?shape=logo');
      expect(SpotlightSlide.fromJson(base).logoPath, isNull);
    });

    test('admin folder carries its artwork; a missing one parses as none', () {
      final base = {'_id': 'f', 'parentFolderId': 'root', 'driveName': 'House of The Dragon', 'status': 'published'};
      final matched = CatalogFolder.fromJson({...base, 'artwork': _artworkJson});
      expect(matched.artwork?.tmdbUrl, 'https://www.themoviedb.org/tv/94997');
      expect(matched.artwork?.year, 2022);
      expect(matched.artwork?.certificate, 'A');
      expect(matched.artwork?.rating?.label, '8.4');
      expect(matched.artwork?.genres, ['Drama', 'Fantasy']);
      expect(matched.artwork?.castCount, 1);
      expect(matched.artwork?.hasLogo, isTrue);
      expect(matched.artworkAutoOff, isFalse);
      expect(matched.episodeArtworkOff, isFalse);
      final removed = CatalogFolder.fromJson({...base, 'artwork': null, 'artworkAutoOff': true});
      expect(removed.artwork, isNull);
      expect(removed.artworkAutoOff, isTrue);
      expect(CatalogFolder.fromJson(base).artwork, isNull);
    });

    test('a season folder is told which series it belongs to', () {
      final guessed = AdminFolderDetail.fromJson({
        'folder': {'_id': 'f', 'parentFolderId': 'x', 'driveName': 'Season 2', 'status': 'published'},
        'breadcrumbs': [],
        'childFolders': [],
        'childVideos': [],
        'episodeSeries': {
          'folderId': 'series',
          'title': 'House of the Dragon',
          'season': 2,
          'seasonFromName': true,
        },
      });
      expect(guessed.episodeSeries?.title, 'House of the Dragon');
      expect(guessed.episodeSeries?.season, 2);
      expect(guessed.episodeSeries?.seasonFromName, isTrue);

      final none = AdminFolderDetail.fromJson({
        'folder': {'_id': 'f', 'parentFolderId': 'x', 'driveName': 'S1', 'status': 'published'},
        'breadcrumbs': [],
        'childFolders': [],
        'childVideos': [],
      });
      expect(none.episodeSeries, isNull, reason: 'a folder outside a matched series gets no control');
    });

    test('naming episodes reports what it could not place', () {
      final result = EpisodeMatchResult.fromJson({
        'matched': 10,
        'renamed': 8,
        'unresolved': [
          {'folderId': 'extras', 'name': 'Behind The Scenes'},
        ],
      });
      expect(result.matched, 10);
      expect(result.renamed, 8);
      expect(result.unresolved.single.name, 'Behind The Scenes');
      expect(EpisodeMatchResult.fromJson(const {}).unresolved, isEmpty);
    });

    test('a publish preview flags position-matched seasons and counts what it leaves alone', () {
      final preview = PublishPreview.fromJson({
        'seasons': [
          {
            'folderId': 's5',
            'name': 'Season 5',
            'publishesFolder': true,
            'matchedBy': 'filename+gaps',
            'episodes': [
              {'id': 'a', 'episode': 1, 'name': 'The Wars to Come'},
              {'id': 'b', 'episode': 2, 'name': 'The House of Black and White'},
            ],
          },
          {
            'folderId': 's2',
            'name': 'Season 2',
            'publishesFolder': false,
            'matchedBy': 'position',
            'episodes': [
              {'id': 'c', 'episode': 3, 'name': 'What Is Dead May Never Die'},
            ],
          },
        ],
        'skipped': [
          {'id': 'x', 'name': 'held', 'reason': 'held-back'},
          {'id': 'y', 'name': 'extra', 'reason': 'no-tmdb-name'},
          {'id': 'z', 'name': 'extra 2', 'reason': 'no-tmdb-name'},
        ],
        'seriesHidden': false,
        'published': false,
      });
      expect(preview.total, 3);
      expect(preview.seasons.first.publishesFolder, isTrue);
      expect(preview.seasons.last.matchedBy, 'position');
      expect(preview.seasons.first.episodes.last.name, 'The House of Black and White');
      expect(preview.skipped, {'held-back': 1, 'no-tmdb-name': 2});
      expect(preview.published, isFalse);
      // A backend that sends nothing to publish.
      expect(PublishPreview.fromJson(const {}).total, 0);
    });

    test('isTopLevel defaults to false for an older backend', () {
      final detail = AdminFolderDetail.fromJson({
        'folder': {'_id': 'f', 'parentFolderId': 'x', 'driveName': 'S1', 'status': 'published'},
        'breadcrumbs': [],
        'childFolders': [],
        'childVideos': [],
      });
      expect(detail.isTopLevel, isFalse);
    });

    test('match-missing result lists what still needs a link', () {
      final result = ArtworkAutoMatchResult.fromJson({
        'matched': [
          {'kind': 'video', 'id': 'v', 'name': 'Weapons', 'tmdbTitle': 'Weapons', 'year': 2025},
        ],
        'unmatched': [
          {'kind': 'folder', 'id': 'f', 'name': "India's got Latent s2", 'query': "India's got Latent", 'year': null},
        ],
      });
      expect(result.matched, 1);
      expect(result.unmatched.single.name, "India's got Latent s2");
    });
  });

  group('facts line and cast', () {
    testWidgets('shows only what TMDb knows, dot-separated', (tester) async {
      await tester.pumpWidget(_host(
        800,
        const MetaLine(
          meta: TitleMeta(
            year: 2025,
            runtimeMinutes: 128,
            genres: ['Horror', 'Mystery'],
            certificate: 'A',
            rating: TmdbRating(average: 7.4, count: 1200),
          ),
          extra: ['3 seasons here'],
        ),
      ));
      await tester.pump();
      expect(tester.takeException(), isNull);
      expect(find.text('7.4'), findsOneWidget);
      expect(find.text('2025'), findsOneWidget);
      expect(find.text('A'), findsOneWidget);
      expect(find.text('2h 8m'), findsOneWidget);
      expect(find.text('Horror, Mystery'), findsOneWidget);
      expect(find.text('3 seasons here'), findsOneWidget);
    });

    testWidgets('an unmatched title renders no facts line at all', (tester) async {
      await tester.pumpWidget(_host(800, const MetaLine(meta: TitleMeta())));
      await tester.pump();
      expect(tester.takeException(), isNull);
      expect(find.byType(Wrap), findsNothing, reason: 'an empty row would leave a stray separator');
    });

    testWidgets('cast row is nothing when nobody is listed', (tester) async {
      await tester.pumpWidget(_host(800, const CastRow(cast: [], gutter: 16)));
      await tester.pump();
      expect(find.text('Cast'), findsNothing);
    });

    testWidgets('a wordmark falls back to the title in type', (tester) async {
      await tester.pumpWidget(_host(
        800,
        TitleWordmark(path: null, title: 'Weapons', textStyle: const TextStyle(fontSize: 20)),
      ));
      await tester.pump();
      expect(tester.takeException(), isNull);
      expect(find.text('Weapons'), findsOneWidget);
    });
  });

  group('admin artwork panel', () {
    final artwork = CatalogArtwork.tryParse(_artworkJson);

    for (final width in [1000.0, 380.0]) {
      testWidgets('matched folder with a Drive image — fits at ${width.toInt()}px', (tester) async {
        tester.view.physicalSize = Size(width, 1400);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        await tester.pumpWidget(_host(
          width,
          AdminArtworkPanel(
            kind: 'folder',
            id: 'f',
            artwork: artwork,
            autoOff: false,
            hasDriveThumbnail: true,
            currentTitle: 'House of The Dragon',
            onChanged: () {},
          ),
        ));
        await tester.pump();
        expect(tester.takeException(), isNull);
        expect(find.text('House of the Dragon (2022)'), findsOneWidget);
        // The facts line proves at a glance that the right title was matched.
        expect(find.textContaining('Drama, Fantasy'), findsOneWidget);
        // The names differ only in case, which the automatic pass leaves alone — so it's offered.
        expect(find.text('Rename to "House of the Dragon"'), findsOneWidget);
        // Matched, so TMDb's image is what viewers see: no Drive note.
        expect(find.textContaining('thumbnail image in this folder in Drive'), findsNothing);
        expect(find.text('Remove'), findsOneWidget);
        // "Use link" stays disabled until something is typed.
        final useLink = tester.widget<ElevatedButton>(find.widgetWithText(ElevatedButton, 'Use link'));
        expect(useLink.onPressed, isNull);
        await tester.enterText(find.byType(TextField), 'https://www.imdb.com/title/tt11198330/');
        await tester.pump();
        expect(tester.widget<ElevatedButton>(find.widgetWithText(ElevatedButton, 'Use link')).onPressed, isNotNull);
      });
    }

    testWidgets('unmatched movie: no Remove, says how to fix it', (tester) async {
      await tester.pumpWidget(_host(
        800,
        AdminArtworkPanel(
          kind: 'video',
          id: 'v',
          artwork: null,
          autoOff: false,
          hasDriveThumbnail: false,
          currentTitle: 'Weapons.2025.1080p.mkv',
          onChanged: () {},
        ),
      ));
      await tester.pump();
      expect(tester.takeException(), isNull);
      expect(find.textContaining('Not matched yet'), findsOneWidget);
      expect(find.text('Remove'), findsNothing);
      expect(find.text('Find automatically'), findsOneWidget);
      // Nothing matched, so there is no TMDb name to offer.
      expect(find.textContaining('Rename to'), findsNothing);
    });

    testWidgets('removed: says it will not be matched again', (tester) async {
      await tester.pumpWidget(_host(
        800,
        AdminArtworkPanel(
          kind: 'video',
          id: 'v',
          artwork: null,
          autoOff: true,
          hasDriveThumbnail: false,
          currentTitle: 'Weapons',
          onChanged: () {},
        ),
      ));
      await tester.pump();
      expect(find.textContaining("won't be matched automatically again"), findsOneWidget);
    });
  });
}
