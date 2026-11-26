import 'package:campfire_mobile/models/catalog.dart';
import 'package:campfire_mobile/models/title_meta.dart';
import 'package:campfire_mobile/widgets/web_player.dart';
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

const _features = {
  'autoplay': true,
  'exit': true,
  'pip': true,
  'sourceMenu': false,
  'captions': true,
  'quality': true,
  'volume': true,
  'fullscreen': true,
  'settings': true,
};

void main() {
  test('an older backend sends no embeds and no TMDb id: the file plays from Drive', () {
    final video = VideoResponse.fromJson(_video({}));
    expect(video.embeds, isEmpty);
    expect(video.meta.tmdb, isNull);
    expect(video.players.map((p) => p.id), ['drive']);
    expect(video.sources.map((s) => s.id), ['drive']);
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
    // An older backend's players: the embeds, then the file.
    expect(video.players.map((p) => p.id), ['embed-0', 'embed-1', 'drive']);
    expect(playChoices(video.players, video.sources).map((s) => s.id), ['embed-0', 'embed-1', 'drive']);
  });

  test('a TMDb ref needs a known type and an id', () {
    expect(TmdbRef.tryParse({'type': 'person', 'id': '1'}), isNull);
    expect(TmdbRef.tryParse({'type': 'tv', 'id': 1}), isNull);
  });

  test('players and sources from a current backend', () {
    final video = VideoResponse.fromJson(_video({
      'fileId': 'tmdb:tv:1396:s1e2',
      'seriesTitle': 'Breaking Bad',
      'players': [
        {'id': 'embed-0', 'kind': 'embed', 'name': 'YouTube', 'url': 'https://www.youtube.com/embed/x'},
        {
          'id': 'z',
          'kind': 'frame',
          'name': 'Zoryva',
          'url': 'https://zoryva.me/embed/tv/1396/1/2',
          'frame': {'allow': 'autoplay', 'allowFullscreen': false, 'sandbox': 'allow-scripts', 'referrerPolicy': 'origin', 'radius': 0, 'ratio': null},
        },
        {'id': 'b', 'kind': 'stream', 'name': 'Bunny', 'features': _features},
        {'id': 'x', 'kind': 'teleport', 'name': 'Nope'},
        {'id': 'f', 'kind': 'frame', 'name': 'No address'},
      ],
      'sources': [
        {'id': 'z', 'name': 'Zoryva'},
        {'id': 'b', 'name': 'Bunny'},
        {'id': 'drive', 'name': 'Drive'},
      ],
    }));
    expect(video.isTitle, isTrue);
    expect(video.seriesTitle, 'Breaking Bad');
    expect(video.players.map((p) => p.id), ['embed-0', 'z', 'b']);
    final frame = video.players[1];
    expect(frame.isWeb, isTrue);
    expect(frame.frame.sandbox, 'allow-scripts');
    expect(frame.frame.allowFullscreen, isFalse);
    expect(video.players[2].features.sourceMenu, isFalse);
    expect(video.players[2].features.captions, isTrue);
    expect(playChoices(video.players, video.sources).map((s) => s.id), ['embed-0', 'z', 'b', 'drive']);
  });

  test('nothing is tried by itself', () {
    const one = [ViewerSource(id: 'drive', name: 'Drive')];
    const two = [ViewerSource(id: 'drive', name: 'Drive'), ViewerSource(id: 'z', name: 'Zoryva')];
    expect(pickSource(inParty: false, choices: two), isNull);
    expect(pickSource(inParty: false, choices: one), 'drive');
    expect(pickSource(inParty: false, requested: 'z', choices: two), 'z');
    expect(pickSource(inParty: false, chosen: 'drive', requested: 'z', choices: two), 'drive');
    // A party always plays the file.
    expect(pickSource(inParty: true, chosen: 'z', choices: two), 'drive');
  });

  test('a Zoryva player starts where the viewer left off', () {
    expect(zoryvaUrlAt('https://zoryva.me/embed/movie/603', 125.7), 'https://zoryva.me/embed/movie/603?startAt=125');
    expect(zoryvaUrlAt('https://zoryva.me/embed/movie/603', 2), 'https://zoryva.me/embed/movie/603');
    expect(zoryvaUrlAt('https://example.com/embed/603', 125), 'https://example.com/embed/603');
  });

  test('what a frame says', () {
    expect(readFrameMessage('zoryva.me', '{"type":"zoryva:embed-close"}'), isA<FrameClosed>());
    final progress = readFrameMessage(
      'www.zoryva.me',
      '{"type":"ZORYVA_PLAYER_EVENT","data":{"event":"pause","currentTime":61.5,"duration":5400}}',
    );
    expect(progress, isA<FrameProgress>());
    expect((progress as FrameProgress).currentTime, 61.5);
    expect(readFrameMessage('www.youtube.com', '{"event":"onError","info":150}'), isA<FrameFailed>());
    expect(readFrameMessage('player.vimeo.com', '{"event":"error","data":{"name":"PlayRestrictedError"}}'), isNull);
    expect(readFrameMessage('player.vimeo.com', '{"event":"error","data":{"name":"NotFoundError"}}'), isA<FrameFailed>());
    expect(readFrameMessage('example.com', 'not json'), isNull);
  });

  test("the player's page keeps the embed code's attributes, escaped", () {
    final page = playerPage(
      'https://zoryva.me/embed/movie/603?a=1&b="2"',
      const PlayerFrame(allow: 'autoplay; fullscreen', sandbox: 'allow-scripts allow-same-origin', allowFullscreen: false),
    );
    expect(page, contains('src="https://zoryva.me/embed/movie/603?a=1&amp;b=&quot;2&quot;"'));
    expect(page, contains('sandbox="allow-scripts allow-same-origin"'));
    expect(page, isNot(contains('allowfullscreen')));
  });
}
