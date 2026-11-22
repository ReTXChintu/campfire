import 'dart:io';

import 'package:campfire_mobile/models/catalog.dart';
import 'package:campfire_mobile/screens/profile_screen.dart';
import 'package:campfire_mobile/services/auth_service.dart';
import 'package:campfire_mobile/theme/app_theme.dart';
import 'package:campfire_mobile/utils/start_tracks.dart';
import 'package:campfire_mobile/widgets/title_meta_views.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// Audio and subtitle tracks: the new fields on the video/folder/me responses (absent on an
/// older backend, null before a file is read), how the start tracks map onto mpv's track list,
/// and the languages line and profile settings at a large text size on a small phone.
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

Map<String, dynamic> _video([Map<String, dynamic> extra = const {}]) => {
  'fileId': 'f1',
  'title': 'DC',
  'backHref': '/',
  'parentFolderId': 'root',
  'episodes': <Object>[],
  'progressByFileId': <String, Object>{},
  'initialPositionSeconds': 0,
  'initialCompleted': false,
  'seekMode': 'raw',
  'subtitles': [
    {'index': 0, 'language': 'eng', 'title': null, 'vtt': 'WEBVTT'},
  ],
  ...extra,
};

Map<String, dynamic> _folder([Map<String, dynamic> extra = const {}]) => {
  'mode': 'series',
  'folderId': 'd1',
  'title': 'Attack on Titan',
  'backHref': '/',
  ...extra,
};

const _languagesJson = {
  'audio': [
    {'code': 'hin', 'name': 'Hindi', 'partial': false},
    {'code': 'tam', 'name': 'Tamil', 'partial': true},
  ],
  'subtitles': [
    {'code': 'eng', 'name': 'English', 'partial': false},
  ],
};

Future<void> _pump(WidgetTester tester, Widget child, {Size size = const Size(360, 780), double scale = 1.4}) async {
  tester.view.physicalSize = size * 2;
  tester.view.devicePixelRatio = 2;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: ThemeData(brightness: Brightness.dark, fontFamily: 'Roboto', scaffoldBackgroundColor: AppColors.background),
    home: MediaQuery(
      data: MediaQueryData(size: size, textScaler: TextScaler.linear(scale)),
      child: Scaffold(body: ListView(padding: const EdgeInsets.symmetric(horizontal: 16), children: [child])),
    ),
  ));
  await tester.pump(const Duration(milliseconds: 100));
}

void main() {
  setUpAll(_loadFonts);

  group('video response', () {
    test('an older backend: no start tracks, no names, no languages', () {
      final v = VideoResponse.fromJson(_video());
      expect(v.hasStartTracks, isFalse);
      expect(v.audioTracks, isNull);
      expect(v.subtitleTracks, isNull);
      expect(v.startAudio, isNull);
      expect(v.startSubtitle, isNull);
      expect(v.languages, isNull);
    });

    test('a file not read yet: the fields are there but null', () {
      final v = VideoResponse.fromJson(_video({
        'audioTracks': null,
        'subtitleTracks': null,
        'startAudio': null,
        'startSubtitle': null,
        'languages': null,
      }));
      expect(v.hasStartTracks, isTrue);
      expect(v.audioTracks, isNull);
      expect(v.subtitleTracks, isNull);
      expect(v.startAudio, isNull);
      expect(v.startSubtitle, isNull);
      expect(v.languages, isNull);
    });

    test('everything', () {
      final v = VideoResponse.fromJson(_video({
        'audioTracks': [
          {'n': 1, 'label': 'Hindi', 'language': 'hin', 'languageName': 'Hindi', 'isDefault': true, 'forced': false, 'codec': 'aac', 'channels': 2},
          {'n': 2, 'label': 'Tamil 5.1', 'language': 'tam', 'languageName': 'Tamil', 'isDefault': false, 'forced': false, 'codec': 'eac3', 'channels': 6},
          {'label': 'broken: no n'},
        ],
        'subtitleTracks': [
          {'n': 1, 'label': 'Signs & songs', 'language': 'eng', 'languageName': 'English', 'isDefault': false, 'forced': true, 'codec': 'ass', 'channels': null},
        ],
        'startAudio': 2,
        'startSubtitle': {'source': 'embedded', 'n': 1},
        'languages': _languagesJson,
      }));
      expect(v.hasStartTracks, isTrue);
      expect(v.audioTracks!.map((t) => t.mpvId), ['1', '2']);
      expect(v.audioTracks![1].label, 'Tamil 5.1');
      expect(v.audioTracks![1].channels, 6);
      expect(v.audioTracks![0].isDefault, isTrue);
      expect(v.subtitleTracks!.single.forced, isTrue);
      expect(v.subtitleTracks!.single.channels, isNull);
      expect(v.startAudio, 2);
      expect(v.startSubtitle, const StartSubtitle.embedded(1));
      expect(v.languages!.parts, ['Audio: Hindi, Tamil (some episodes)', 'Subtitles: English']);
    });

    test('start subtitle shapes', () {
      expect(StartSubtitle.tryParse({'source': 'off'}), const StartSubtitle.off());
      expect(StartSubtitle.tryParse({'source': 'external', 'index': 0}), const StartSubtitle.external(0));
      expect(StartSubtitle.tryParse({'source': 'embedded'}), isNull);
      expect(StartSubtitle.tryParse({'source': 'restart', 'index': 3}), isNull);
      expect(StartSubtitle.tryParse(null), isNull);
    });
  });

  group('folder response', () {
    test('languages absent, null and present', () {
      expect(FolderResponse.fromJson(_folder()).languages, isNull);
      expect(FolderResponse.fromJson(_folder({'languages': null})).languages, isNull);
      final languages = FolderResponse.fromJson(_folder({'languages': _languagesJson})).languages!;
      expect(languages.audio.map((l) => l.code), ['hin', 'tam']);
      expect(languages.audio[1].partial, isTrue);
      expect(languages.isEmpty, isFalse);
    });

    test('an empty languages object says nothing', () {
      final languages = TitleLanguages.tryParse({'audio': <Object>[], 'subtitles': <Object>[]})!;
      expect(languages.isEmpty, isTrue);
      expect(languages.parts, isEmpty);
    });
  });

  group('current user', () {
    const base = {'userId': 'u', 'email': 'a@b.c'};
    test('an older backend has no language settings', () {
      final user = CurrentUser.fromJson(Map<String, dynamic>.from(base));
      expect(user.supportsLanguages, isFalse);
      expect(user.languages, isNull);
    });

    test('never set', () {
      final user = CurrentUser.fromJson({...base, 'languages': null});
      expect(user.supportsLanguages, isTrue);
      expect(user.languages, isNull);
    });

    test('set', () {
      final user = CurrentUser.fromJson({
        ...base,
        'languages': {'audio': ['hin', 'eng'], 'subtitles': 'eng', 'subtitleMode': 'foreign'},
      });
      expect(user.languages!.audio, ['hin', 'eng']);
      expect(user.languages!.subtitles, 'eng');
      expect(user.languages!.subtitleMode, 'foreign');
      expect(user.languages!.toJson(), {'audio': ['hin', 'eng'], 'subtitles': 'eng', 'subtitleMode': 'foreign'});
      expect(user.withLanguages(null).languages, isNull);
      expect(user.withLanguages(null).supportsLanguages, isTrue);
    });

    test('an unknown subtitle mode reads as off', () {
      expect(LanguagePrefs.tryParse({'audio': <Object>[], 'subtitleMode': 'sometimes'})!.subtitleMode, 'off');
    });

    test('copyWith can clear the subtitle language', () {
      const prefs = LanguagePrefs(audio: ['hin'], subtitles: 'eng', subtitleMode: 'always');
      expect(prefs.copyWith(subtitleMode: 'off').subtitles, 'eng');
      expect(prefs.copyWith(subtitles: null).subtitles, isNull);
    });
  });

  group('start tracks', () {
    StartTrackPlan plan({
      int? audio,
      StartSubtitle? subtitle,
      List<String> audioIds = const ['1', '2'],
      List<String> subtitleIds = const ['1', '2', '3'],
      bool known = true,
      int external = 1,
    }) =>
        planStartTracks(
          startAudio: audio,
          startSubtitle: subtitle,
          audioIds: audioIds,
          subtitleIds: subtitleIds,
          tracksKnown: known,
          externalCount: external,
        );

    test('nothing to start on leaves both alone', () {
      final p = plan();
      expect(p.audioPending, isFalse);
      expect(p.audioId, isNull);
      expect(p.subtitlePending, isFalse);
      expect(p.subtitle, isNull);
    });

    test('audio n is mpv aid "n"', () {
      expect(plan(audio: 2).audioId, '2');
    });

    test('waits for the track list, then never for a track the file lacks', () {
      final waiting = plan(audio: 2, subtitle: const StartSubtitle.embedded(3), audioIds: [], subtitleIds: [], known: false);
      expect(waiting.audioPending, isTrue);
      expect(waiting.subtitlePending, isTrue);
      final missing = plan(audio: 5, subtitle: const StartSubtitle.embedded(9));
      expect(missing.audioPending, isFalse);
      expect(missing.audioId, isNull);
      expect(missing.subtitlePending, isFalse);
      expect(missing.subtitle, isNull);
    });

    test('a file with no subtitle tracks at all is known once its video is', () {
      final p = plan(subtitle: const StartSubtitle.embedded(1), audioIds: [], subtitleIds: [], known: true);
      expect(p.subtitlePending, isFalse);
      expect(p.subtitle, isNull);
    });

    test('embedded subtitle n is mpv sid "n"', () {
      expect(plan(subtitle: const StartSubtitle.embedded(2)).subtitle, const StartSubtitle.embedded(2));
    });

    test('off and an upload need no track list', () {
      final off = plan(subtitle: const StartSubtitle.off(), audioIds: [], subtitleIds: [], known: false);
      expect(off.subtitlePending, isFalse);
      expect(off.subtitle, const StartSubtitle.off());
      final upload = plan(subtitle: const StartSubtitle.external(0), known: false);
      expect(upload.subtitle, const StartSubtitle.external(0));
    });

    test('an upload index out of range is ignored', () {
      expect(plan(subtitle: const StartSubtitle.external(1)).subtitle, isNull);
      expect(plan(subtitle: const StartSubtitle.external(-1)).subtitle, isNull);
    });
  });

  group('large text on a small phone', () {
    testWidgets('languages line wraps instead of overflowing', (tester) async {
      await _pump(
        tester,
        TitleLanguagesLine(
          languages: TitleLanguages.tryParse({
            'audio': [
              for (final name in ['Hindi', 'Tamil', 'Telugu', 'Malayalam', 'Kannada', 'English'])
                {'code': name.substring(0, 3).toLowerCase(), 'name': name, 'partial': name != 'Hindi'},
            ],
            'subtitles': [
              {'code': 'eng', 'name': 'English', 'partial': false},
              {'code': 'hin', 'name': 'Hindi', 'partial': true},
            ],
          }),
        ),
      );
      expect(tester.takeException(), isNull);
      expect(find.textContaining('Malayalam (some episodes)', findRichText: true), findsOneWidget);
    });

    testWidgets('nothing at all when there are no languages', (tester) async {
      await _pump(tester, const TitleLanguagesLine(languages: null));
      expect(tester.takeException(), isNull);
      expect(find.byType(Text), findsNothing);
    });

    testWidgets('profile languages: rows, the subtitle picker and a save', (tester) async {
      LanguagePrefs? saved;
      await _pump(
        tester,
        LanguageSettingsSection(
          prefs: const LanguagePrefs(audio: ['hin', 'tam'], subtitles: null, subtitleMode: 'off'),
          loadOptions: () async => const [
            LanguageOption(code: 'eng', name: 'English', inLibrary: true),
            LanguageOption(code: 'hin', name: 'Hindi', inLibrary: true),
            LanguageOption(code: 'tam', name: 'Tamil', inLibrary: true),
            LanguageOption(code: 'jpn', name: 'Japanese'),
          ],
          onSave: (prefs) async => saved = prefs,
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('Hindi'), findsOneWidget);
      expect(find.text('Tamil'), findsOneWidget);
      expect(find.text('Third choice'), findsOneWidget);
      expect(find.text('Subtitle language'), findsNothing);

      // Subtitles on: the long option has to fit the sheet, and a language is asked for first.
      await tester.tap(find.text('Subtitles'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.tap(find.text("Only when the audio isn't one of my languages"));
      await tester.pumpAndSettle();
      expect(find.text('Subtitle language'), findsOneWidget);
      await tester.tap(find.text('English').last);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(saved?.toJson(), {'audio': ['hin', 'tam'], 'subtitles': 'eng', 'subtitleMode': 'foreign'});
    });

    testWidgets('profile languages: never set', (tester) async {
      await _pump(
        tester,
        LanguageSettingsSection(
          prefs: null,
          loadOptions: () async => const [],
          onSave: (_) async {},
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('Audio language'), findsOneWidget);
      expect(find.text('Second choice'), findsNothing);
    });
  });
}
