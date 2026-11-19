import 'dart:io';

import 'package:campfire_mobile/models/explore.dart';
import 'package:campfire_mobile/theme/app_theme.dart';
import 'package:campfire_mobile/utils/fisheye_layout.dart';
import 'package:campfire_mobile/widgets/explore_detail.dart';
import 'package:campfire_mobile/widgets/fisheye_wall.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';

/// Explore: the wall's geometry (it has to agree with the shader, or a tap opens the wrong
/// poster), the API shapes, the where-to-watch panel at phone and desktop sizes, and the wall
/// drawing through its shader. With SCREENSHOTS=1 the renders go to build/screens/*.png:
///
///   SCREENSHOTS=1 flutter test test/explore_test.dart --update-goldens
Future<void> _loadFonts() async {
  final flutterRoot = Platform.environment['FLUTTER_ROOT'] ??
      File(Platform.resolvedExecutable).parent.parent.parent.parent.parent.parent.path;
  Future<void> load(String family, List<String> paths) async {
    final loader = FontLoader(family);
    for (final path in paths) {
      final file = File(path);
      if (file.existsSync()) loader.addFont(Future.value(ByteData.view(file.readAsBytesSync().buffer)));
    }
    await loader.load();
  }

  final fonts = '$flutterRoot/bin/cache/artifacts/material_fonts';
  await load('MaterialIcons', ['$fonts/materialicons-regular.otf']);
  await load('Roboto', ['$fonts/roboto-regular.ttf', '$fonts/roboto-medium.ttf', '$fonts/roboto-bold.ttf']);
}

Future<void> _shot(WidgetTester tester, String name, Size size, Widget child) async {
  tester.view.physicalSize = size * 2;
  tester.view.devicePixelRatio = 2;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: ThemeData(brightness: Brightness.dark, fontFamily: 'Roboto', scaffoldBackgroundColor: AppColors.background),
    home: Scaffold(backgroundColor: AppColors.bgElevated, body: child),
  ));
  await tester.pump(const Duration(milliseconds: 300));
  if (Platform.environment['SCREENSHOTS'] == '1') {
    Directory('build/screens').createSync(recursive: true);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('../build/screens/$name.png'));
  }
}

const _detailJson = {
  'tmdbType': 'tv',
  'tmdbId': '1399',
  'title': 'Game of Thrones',
  'year': 2011,
  'rating': 8.5,
  'genres': ['Sci-Fi & Fantasy', 'Drama', 'Action & Adventure'],
  'overview': 'Seven noble families fight for control of the mythical land of Westeros.',
  'posterUrl': null,
  'backdropUrl': null,
  'tagline': 'Winter is coming.',
  'runtime': 60,
  'seasons': 8,
  'episodes': 73,
  'cast': [
    {'name': 'Peter Dinklage', 'character': "Tyrion 'The Halfman' Lannister", 'profileUrl': null},
    {'name': 'Kit Harington', 'character': 'Jon Snow', 'profileUrl': null},
  ],
  'link': 'https://www.themoviedb.org/tv/1399',
  'watch': {
    'link': 'https://www.themoviedb.org/tv/1399/watch?locale=IN',
    'stream': [
      {'id': 2336, 'name': 'JioHotstar', 'logoUrl': null, 'url': 'https://www.themoviedb.org/tv/1399/watch?locale=IN'},
    ],
    'free': [],
    'rentBuy': [
      {'id': 2, 'name': 'Apple TV Store', 'logoUrl': null, 'url': 'https://tv.apple.com/search?term=x'},
    ],
  },
  'inLibrary': null,
  'existingRequest': {'id': 'r1', 'wantCount': 3, 'status': 'new', 'iWantIt': false},
};

void main() {
  setUpAll(() async {
    GoogleFonts.config.allowRuntimeFetching = false;
    await _loadFonts();
  });

  group('wall geometry', () {
    test('a cell centre maps back to the same cell, staggered columns included', () {
      for (var c = -7; c <= 7; c++) {
        for (var r = -5; r <= 5; r++) {
          final (x, y) = wallCellCenter(c, r);
          expect(wallCellAt(x, y), (c: c, r: r));
          // Anywhere inside the poster is still that cell.
          expect(wallCellAt(x + 0.45, y - 0.7), (c: c, r: r));
        }
      }
    });

    test('odd columns sit half a poster higher', () {
      expect(wallCellCenter(1, 0).$2, closeTo(wallPitchY / 2, 1e-9));
      expect(wallCellCenter(-1, 0).$2, closeTo(wallPitchY / 2, 1e-9));
      expect(wallCellCenter(2, 0).$2, 0);
    });

    test('the lens centre is the camera, and the lens magnifies the middle', () {
      expect(wallScreenToWall(0, 0, 400, (3, -2), 0.5), (3.0, -2.0));
      // Twice as far out on screen is more than twice as far on the wall.
      final (near, _) = wallScreenToWall(100, 0, 400, (0, 0), 0.5);
      final (far, _) = wallScreenToWall(200, 0, 400, (0, 0), 0.5);
      expect(far, greaterThan(near * 2));
    });

    test('the first item is in the middle, and every item has its own cell', () {
      final layout = WallLayout(300);
      expect(layout.itemCells.first, (c: 0, r: 0));
      expect(layout.itemAt(0, 0), 0);
      expect(layout.itemCells.toSet().length, 300);
      for (var i = 0; i < 300; i++) {
        final cell = layout.itemCells[i];
        expect(layout.itemAt(cell.c, cell.r), i);
      }
      expect(layout.itemAt(9999, 0), -1);
    });
  });

  group('parsing', () {
    test('a wall skips what it cannot draw and tolerates missing fields', () {
      final wall = ExploreWall.fromJson({
        'available': true,
        'imageBase': 'https://image.tmdb.org/t/p',
        'items': [
          {'tmdbType': 'movie', 'tmdbId': '603', 'title': 'The Matrix', 'year': 1999, 'rating': 8.2, 'genres': ['Action'], 'posterPath': '/a.jpg', 'inCampfire': true},
          {'tmdbType': 'tv', 'tmdbId': '1', 'title': 'No poster'},
          {'tmdbType': 'person', 'tmdbId': '2', 'title': 'Not a title', 'posterPath': '/b.jpg'},
        ],
        'services': [
          {'id': 8, 'name': 'Netflix', 'logoUrl': null},
        ],
      });
      expect(wall.items.single.title, 'The Matrix');
      expect(wall.items.single.inCampfire, isTrue);
      expect(wall.items.single.key, 'movie-603');
      expect(wall.services.single.name, 'Netflix');
      expect(ExploreWall.fromJson({'available': false}).available, isFalse);
    });

    test('a title reads its offers, request and meta line', () {
      final d = ExploreDetail.fromJson(Map<String, dynamic>.from(_detailJson));
      expect(d.metaLine, '2011 · Series · 8 seasons');
      expect(d.stream.single.name, 'JioHotstar');
      expect(d.rentBuy.single.name, 'Apple TV Store');
      expect(d.existingRequest?.wantCount, 3);
      expect(d.libraryRoute, isNull);
      final film = ExploreDetail.fromJson({...Map<String, dynamic>.from(_detailJson), 'tmdbType': 'movie', 'runtime': 148, 'inLibrary': {'kind': 'video', 'id': 'f1'}});
      expect(film.metaLine, '2011 · Film · 2h 28m');
      expect(film.libraryRoute, '/watch/f1');
    });
  });

  group('where to watch', () {
    // 1.4× text too: text measures wider on some machines (CI's Linux runner) and with a large
    // phone font, and the panel has to grow rather than overflow.
    for (final (name, size, scale) in [
      ('explore_detail_phone', const Size(390, 844), 1.0),
      ('explore_detail_panel', const Size(460, 900), 1.0),
      ('explore_detail_large_text', const Size(360, 780), 1.4),
    ]) {
      testWidgets('$name: no overflow, offers and a vote', (tester) async {
        await _shot(
          tester,
          name,
          size,
          MediaQuery(
            data: MediaQueryData(size: size, textScaler: TextScaler.linear(scale)),
            child: ExploreDetailView(
              tmdbType: 'tv',
              tmdbId: '1399',
              initial: ExploreDetail.fromJson(Map<String, dynamic>.from(_detailJson)),
              titleStyle: const TextStyle(fontSize: 34, fontWeight: FontWeight.w800, color: AppColors.foreground),
            ),
          ),
        );
        expect(tester.takeException(), isNull);
        expect(find.text('WHERE TO WATCH IN INDIA'), findsOneWidget);
        expect(find.text('JioHotstar'), findsOneWidget);
        expect(find.text('Add my vote'), findsOneWidget);
        expect(find.text('3 people have already asked for this.'), findsOneWidget);
      });
    }
  });

  testWidgets('the wall draws through its shader', (tester) async {
    var failed = false;
    final items = [
      for (var i = 0; i < 120; i++)
        WallItem(tmdbType: i.isEven ? 'movie' : 'tv', tmdbId: '$i', title: 'Title $i', year: 2000 + i % 25, posterPath: '/p$i.jpg', inCampfire: i % 7 == 0),
    ];
    WallItem? focused;
    await tester.runAsync(() async {
      await _shot(
        tester,
        'explore_wall_shader',
        const Size(844, 600),
        FisheyeWall(
          items: items,
          imageBase: 'http://127.0.0.1:9', // no network in tests: posters stay placeholders
          libOnly: false,
          panelOpen: false,
          onOpen: (_) {},
          onFocusChanged: (item) => focused = item,
          onFail: () => failed = true,
        ),
      );
      await Future<void>.delayed(const Duration(milliseconds: 400));
    });
    await tester.pump(const Duration(milliseconds: 100));
    expect(failed, isFalse, reason: 'the shader should load');
    expect(focused?.title, 'Title 0');
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
}
