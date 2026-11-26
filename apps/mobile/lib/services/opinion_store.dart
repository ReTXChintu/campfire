import 'package:flutter/foundation.dart';
import '../models/feed.dart';
import 'api_client.dart';
import 'watch_events.dart';

/// What the viewer has watched, liked and disliked, and what that suggests (backend
/// lib/opinions.ts, lib/forYou.ts; web apps/frontend/src/lib/opinions.ts). All of it is read at
/// once, so any card can look itself up.
enum Rating { like, dislike }

/// A film or a whole series. An episode is neither.
class Opinion {
  final String type; // "movie" | "tv"
  final String id;
  final bool watched;
  final Rating? rating;

  const Opinion({required this.type, required this.id, this.watched = false, this.rating});

  String get key => '$type:$id';

  static Opinion? tryParse(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    final type = json['type'];
    final id = json['id'];
    if ((type != 'movie' && type != 'tv') || id is! String) return null;
    return Opinion(type: type as String, id: id, watched: json['watched'] == true, rating: _rating(json['rating']));
  }

  static Rating? _rating(Object? value) => switch (value) {
        'like' => Rating.like,
        'dislike' => Rating.dislike,
        _ => null,
      };
}

class OpinionStore extends ChangeNotifier {
  OpinionStore() {
    WatchEvents.playerClosed.addListener(_onPlayerClosed);
  }

  @override
  void dispose() {
    WatchEvents.playerClosed.removeListener(_onPlayerClosed);
    super.dispose();
  }

  // A film played to its end counts as watched, server-side.
  void _onPlayerClosed() {
    if (_loaded) refresh();
  }

  final Map<String, Opinion> _byKey = {};
  bool _loaded = false;
  bool _loading = false;
  ForYou? _forYou;
  bool _forYouLoading = false;
  // Changes in flight per title, so a reload doesn't undo one the server hasn't taken yet.
  final Map<String, int> _pending = {};

  ForYou? get forYou => _forYou;

  Opinion? opinionOf(String type, String id) => _byKey['$type:$id'];

  Future<void> ensureLoaded() async {
    if (_loaded || _loading) return;
    await refresh();
  }

  Future<void> refresh() async {
    _loading = true;
    try {
      final data = await ApiClient.get('/api/opinions') as Map<String, dynamic>;
      final fresh = [for (final e in (data['opinions'] as List? ?? const [])) ?Opinion.tryParse(e)];
      final keep = {for (final key in _pending.keys) key: ?_byKey[key]};
      _byKey
        ..clear()
        ..addEntries(fresh.map((o) => MapEntry(o.key, o)))
        ..addAll(keep);
      _loaded = true;
      notifyListeners();
    } catch (_) {
      // Buttons just show nothing set; the next change still saves.
    } finally {
      _loading = false;
    }
    if (_forYou != null) loadForYou(force: true);
  }

  Future<void> loadForYou({bool force = false}) async {
    if (_forYouLoading || (_forYou != null && !force)) return;
    _forYouLoading = true;
    try {
      final data = await ApiClient.get('/api/opinions/for-you') as Map<String, dynamic>;
      _forYou = ForYou.fromJson(data);
      notifyListeners();
    } catch (_) {
      // Home simply has no For you rows.
    } finally {
      _forYouLoading = false;
    }
  }

  /// Shown as set right away, and put back if the server doesn't take it. Throws when it isn't
  /// saved, so the caller can say so.
  Future<void> set(String type, String id, {bool? watched, Rating? rating, bool clearRating = false}) async {
    final key = '$type:$id';
    final before = _byKey[key];
    final mine = before ?? Opinion(type: type, id: id);
    _byKey[key] = Opinion(
      type: type,
      id: id,
      watched: watched ?? mine.watched,
      rating: clearRating ? null : (rating ?? mine.rating),
    );
    _pending[key] = (_pending[key] ?? 0) + 1;
    notifyListeners();
    final body = <String, dynamic>{
      'watched': ?watched,
      if (rating != null || clearRating) 'rating': rating?.name,
    };
    try {
      await ApiClient.put('/api/opinions/$type/$id', body);
    } catch (e) {
      if (before == null) {
        _byKey.remove(key);
      } else {
        _byKey[key] = before;
      }
      notifyListeners();
      rethrow;
    } finally {
      final left = (_pending[key] ?? 1) - 1;
      if (left <= 0) {
        _pending.remove(key);
      } else {
        _pending[key] = left;
      }
    }
    // Only once the last of several quick taps is through.
    if (_pending.isEmpty) loadForYou(force: true);
  }
}
