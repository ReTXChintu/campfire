import 'package:campfire_mobile/models/catalog.dart';
import 'package:campfire_mobile/models/title_meta.dart';
import 'package:campfire_mobile/widgets/embed_player.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> _video(Map<String, dynamic> extra) => {
      'fileId': 'f1',
      'title': 'Night of the Living Dead',
      'backHref': '/',
      'parentFolderId': 'root',
      'episodes': <dynamic>[],
      'progressByFileId': <String, dynamic>{},
      'initialPositionSeconds': 0,
      'initialCompleted': false,
      'seekMode': 'native',
      'subtitles': <dynamic>[],
      ...extra,
    };

void main() {
  test('an older backend sends no embeds and no TMDb id', () {
    final video = VideoResponse.fromJson(_video({}));
    expect(video.embeds, isEmpty);
    expect(video.meta.tmdb, isNull);
  });

  test('embeds keep their order; malformed ones are dropped', () {
    final video = VideoResponse.fromJson(_video({
      'embeds': [
        {'provider': 'Vimeo', 'url': 'https://player.vimeo.com/video/1'},
        {'provider': 'Broken'},
        'nonsense',
        {'provider': 'YouTube', 'url': 'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE'},
      ],
      'tmdb': {'type': 'movie', 'id': '10331'},
    }));
    expect(video.embeds.map((e) => e.provider), ['Vimeo', 'YouTube']);
    expect(video.meta.tmdb?.type, 'movie');
    expect(video.meta.tmdb?.id, '10331');
  });

  test('a TMDb ref needs a known type and an id', () {
    expect(TmdbRef.tryParse({'type': 'person', 'id': '1'}), isNull);
    expect(TmdbRef.tryParse({'type': 'tv', 'id': 1}), isNull);
  });

  testWidgets('offers every player and the library', (tester) async {
    var library = false;
    final video = VideoResponse.fromJson(_video({
      'embeds': [
        {'provider': 'Vimeo', 'url': 'https://player.vimeo.com/video/1'},
        {'provider': 'YouTube', 'url': 'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE'},
      ],
    }));
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: EmbedPlayer(video: video, onUseLibrary: () => library = true)),
    ));
    expect(find.text('Play on Vimeo'), findsOneWidget);
    expect(find.text('Try YouTube'), findsOneWidget);
    await tester.tap(find.text('Play from the library'));
    expect(library, isTrue);
  });
}
