import 'dart:io';

import 'package:campfire_mobile/models/catalog.dart';
import 'package:campfire_mobile/theme/app_theme.dart';
import 'package:campfire_mobile/widgets/episodes_panel.dart';
import 'package:campfire_mobile/widgets/player_chrome.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';

/// Renders the player's controls and episode list in the layouts a phone actually shows and fails
/// on any overflow — the first thing a cramped layout does. With SCREENSHOTS=1 it also writes each
/// one, with real fonts, to build/screens/*.png to look at:
///
///   flutter test test/player_chrome_test.dart
///   SCREENSHOTS=1 flutter test test/player_chrome_test.dart --update-goldens
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

Widget _frame({required Size size, required Widget child}) {
  return MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: ThemeData(brightness: Brightness.dark, fontFamily: 'Roboto', scaffoldBackgroundColor: AppColors.background),
    home: Scaffold(
      backgroundColor: Colors.black,
      body: Center(
        child: SizedBox(
          width: size.width,
          height: size.height,
          child: Stack(
            fit: StackFit.expand,
            children: [
              // Stand-in for the video frame.
              const DecoratedBox(
                decoration: BoxDecoration(
                  gradient: RadialGradient(colors: [Color(0xFF5A3A2A), Color(0xFF000000)], radius: 1.1),
                ),
              ),
              const DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [Color(0x9E000000), Color(0x00000000), Color(0x00000000), Color(0xC7000000)],
                    stops: [0, 0.26, 0.62, 1],
                  ),
                ),
              ),
              child,
            ],
          ),
        ),
      ),
    ),
  );
}

PlayerChrome _chrome({required bool landscape, bool locked = false, int members = 3, int unread = 2}) {
  void noop() {}
  void noopD(double _) {}
  return PlayerChrome(
    visible: true,
    landscape: landscape,
    title: 'Weapons',
    metaLine: '2025 · 1080p · MKV',
    playing: true,
    locked: locked,
    position: const Duration(minutes: 41, seconds: 12),
    buffered: const Duration(minutes: 46),
    duration: const Duration(hours: 2, minutes: 8, seconds: 29),
    scrubSeconds: null,
    ticks: const [95, 180, 7400],
    subtitleLabel: 'English',
    audioLabel: 'Hindi',
    speedLabel: '1×',
    hasEpisodes: false,
    hasNext: false,
    showPip: landscape,
    showFullscreen: true,
    fullscreenActive: landscape,
    party: PlayerPartyChip(members: members, unread: unread, locked: locked, onTap: noop),
    onBack: noop,
    onTogglePlay: noop,
    onSkipBack: noop,
    onSkipForward: noop,
    onScrubStart: noopD,
    onScrubUpdate: noopD,
    onScrubEnd: noopD,
    onScrubCancel: noop,
    onLockedTap: noop,
    onSubtitles: noop,
    onAudio: noop,
    onSpeed: noop,
    onEpisodes: noop,
    onNext: noop,
    onPip: noop,
    onFullscreen: noop,
  );
}

Future<void> _shot(WidgetTester tester, String name, Size size, Widget child) async {
  tester.view.physicalSize = size * 2;
  tester.view.devicePixelRatio = 2;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(_frame(size: size, child: child));
  await tester.pumpAndSettle();
  if (Platform.environment['SCREENSHOTS'] == '1') {
    Directory('build/screens').createSync(recursive: true);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('../build/screens/$name.png'));
  }
}

void main() {
  setUpAll(() async {
    // Tests have no network; the display face falls back to the loaded Roboto.
    GoogleFonts.config.allowRuntimeFetching = false;
    await _loadFonts();
  });

  // Overflow is reported as a FlutterError; any one fails the test.
  testWidgets('landscape phone, in a party, nothing overflows', (tester) async {
    await _shot(tester, 'player_landscape', const Size(844, 390), _chrome(landscape: true));
    expect(tester.takeException(), isNull);
  });

  testWidgets('landscape with the party panel docked (video narrowed)', (tester) async {
    await _shot(tester, 'player_landscape_docked', const Size(524, 390), _chrome(landscape: true, locked: true));
    expect(tester.takeException(), isNull);
  });

  testWidgets('upright phone, 16:9 box on a narrow 360dp phone', (tester) async {
    await _shot(tester, 'player_portrait', const Size(360, 203), _chrome(landscape: false, members: 0, unread: 0));
    expect(tester.takeException(), isNull);
  });

  testWidgets('episode list shows watched / in progress / unwatched', (tester) async {
    final episodes = [
      for (var i = 1; i <= 6; i++) EpisodeRef(id: 'e$i', name: 'Attack on Titan S01E0$i'),
    ];
    final progress = {
      'e1': const EpisodeProgress(positionSeconds: 1400, durationSeconds: 1440, completed: true),
      'e2': const EpisodeProgress(positionSeconds: 1430, durationSeconds: 1440, completed: true),
      'e3': const EpisodeProgress(positionSeconds: 1438, durationSeconds: 1440, completed: true),
      'e4': const EpisodeProgress(positionSeconds: 600, durationSeconds: 1440, completed: false),
    };
    await _shot(
      tester,
      'player_episodes',
      const Size(380, 470),
      ColoredBox(
        color: AppColors.bgElevated,
        child: ListView(
          children: [
            for (var i = 0; i < episodes.length; i++)
              EpisodeListRow(
                number: i + 1,
                episode: episodes[i],
                progress: progress[episodes[i].id],
                current: episodes[i].id == 'e4',
                gutter: 14,
                onTap: () {},
              ),
          ],
        ),
      ),
    );
    expect(tester.takeException(), isNull);
    expect(find.text('Watched'), findsNWidgets(3));
    expect(find.text('Now playing'), findsOneWidget);
  });
}
