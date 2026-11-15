import 'package:campfire_mobile/models/admin_catalog.dart';
import 'package:campfire_mobile/models/catalog.dart';
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
};

Widget _host(double width, Widget child) => MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(child: SizedBox(width: width, child: child)),
      ),
    );

void main() {
  group('parsing', () {
    test('series page carries year and synopsis, and tolerates an older backend without them', () {
      final base = {'mode': 'series', 'folderId': 'f', 'title': 'HOTD', 'backHref': '/', 'thumbnailFileId': 'tmdb'};
      final withMeta = FolderResponse.fromJson({...base, 'year': 2022, 'overview': 'Dragons.'});
      expect(withMeta.year, 2022);
      expect(withMeta.overview, 'Dragons.');
      final older = FolderResponse.fromJson(base);
      expect(older.year, isNull);
      expect(older.overview, isNull);
    });

    test('admin folder carries its artwork; a missing one parses as none', () {
      final base = {'_id': 'f', 'parentFolderId': 'root', 'driveName': 'House of The Dragon', 'status': 'published'};
      final matched = CatalogFolder.fromJson({...base, 'artwork': _artworkJson});
      expect(matched.artwork?.tmdbUrl, 'https://www.themoviedb.org/tv/94997');
      expect(matched.artwork?.year, 2022);
      expect(matched.artworkAutoOff, isFalse);
      final removed = CatalogFolder.fromJson({...base, 'artwork': null, 'artworkAutoOff': true});
      expect(removed.artwork, isNull);
      expect(removed.artworkAutoOff, isTrue);
      expect(CatalogFolder.fromJson(base).artwork, isNull);
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
            onChanged: () {},
          ),
        ));
        await tester.pump();
        expect(tester.takeException(), isNull);
        expect(find.text('House of the Dragon (2022)'), findsOneWidget);
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
          onChanged: () {},
        ),
      ));
      await tester.pump();
      expect(tester.takeException(), isNull);
      expect(find.textContaining('Not matched yet'), findsOneWidget);
      expect(find.text('Remove'), findsNothing);
      expect(find.text('Find automatically'), findsOneWidget);
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
          onChanged: () {},
        ),
      ));
      await tester.pump();
      expect(find.textContaining("won't be matched automatically again"), findsOneWidget);
    });
  });
}
