import 'package:campfire_mobile/models/feed.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> _item(String id, {String type = 'movie'}) => {
      'tmdbType': type,
      'tmdbId': id,
      'title': 'Title $id',
      'year': 2020,
      'rating': 7.4,
      'genres': ['Drama', 3],
      'overview': null,
      'posterUrl': 'https://image.tmdb.org/t/p/w342/$id.jpg',
      'backdropUrl': 'https://image.tmdb.org/t/p/w1280/$id.jpg',
      'services': <int>[],
      'inLibrary': null,
    };

FeedSection _section(String id, Iterable<String> ids, {String look = 'poster'}) => FeedSection.tryParse({
      'id': id,
      'title': id,
      'look': look,
      'items': [for (final i in ids) _item(i)],
    })!;

void main() {
  test('a feed page parses, dropping malformed items', () {
    final page = FeedPage.fromJson({
      'available': true,
      'hero': [
        {..._item('603'), 'logoUrl': 'https://image.tmdb.org/t/p/w500/logo.png'},
      ],
      'sections': [
        {
          'id': 'top',
          'title': 'Top ten',
          'look': 'rank',
          'items': [
            _item('1396', type: 'tv'),
            {'tmdbType': 'person', 'tmdbId': '1', 'title': 'Nope'},
            'nonsense',
            {
              ..._item('27205'),
              'inLibrary': {'kind': 'video', 'id': 'drive-file'},
            },
          ],
        },
        {'id': 'broken'},
      ],
      'next': 1,
    });
    expect(page.available, isTrue);
    expect(page.next, 1);
    expect(page.hero.single.logoUrl, isNotNull);
    expect(page.sections, hasLength(1));
    final section = page.sections.single;
    expect(section.look, SectionLook.rank);
    expect(section.items.map((i) => i.key), ['tv-1396', 'movie-27205']);
    expect(section.items.first.isSeries, isTrue);
    expect(section.items.first.genres, ['Drama']);
    expect(section.items.last.inLibrary?.id, 'drive-file');
    expect(section.items.last.smallBackdropUrl, 'https://image.tmdb.org/t/p/w780/27205.jpg');
  });

  test('a server without TMDb answers unavailable', () {
    final page = FeedPage.fromJson({'available': false, 'hero': [], 'sections': [], 'next': null});
    expect(page.available, isFalse);
    expect(page.next, isNull);
  });

  test('a section drops what one above it already shows, unless too little is left', () {
    final first = _section('a', List.generate(10, (i) => '$i'));
    // Five new, five repeats: five is too few, so it keeps them all.
    final second = _section('b', List.generate(10, (i) => '${i + 5}'));
    // Ten new, two repeats: the repeats go.
    final third = _section('c', [...List.generate(10, (i) => '${i + 100}'), '0', '1']);
    // A top ten is never thinned.
    final rank = _section('d', ['0', '1', '2'], look: 'rank');

    final out = withoutRepeats([first, second, third, rank]);
    expect(out[0].items, hasLength(10));
    expect(out[1].items, hasLength(10));
    expect(out[2].items.map((i) => i.tmdbId), List.generate(10, (i) => '${i + 100}'));
    expect(out[3].items, hasLength(3));
  });

  test('a row is cut to 24', () {
    final out = withoutRepeats([_section('a', List.generate(40, (i) => '$i'))]);
    expect(out.single.items, hasLength(24));
  });

  test('For you keeps its reasons', () {
    final forYou = ForYou.fromJson({
      'ready': true,
      'library': [
        {'kind': 'folder', 'id': 'f1', 'reason': 'Because you liked Dark'},
        {'kind': 'video'},
      ],
      'explore': [
        {..._item('603'), 'reason': 'With Keanu Reeves'},
      ],
    });
    expect(forYou.ready, isTrue);
    expect(forYou.library.single.reason, 'Because you liked Dark');
    expect(forYou.explore.single.reason, 'With Keanu Reeves');
  });
}
