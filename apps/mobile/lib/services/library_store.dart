import 'package:flutter/foundation.dart';
import '../models/catalog.dart';
import 'catalog_service.dart';
import 'watch_events.dart';

/// One in-memory copy of `GET /api/library`, shared by Home, Search and Browse.
///
/// Those three screens are separate navigation branches that all read the same library payload,
/// and there is **no search endpoint on the backend** — search and the browse grid filter this
/// list client-side. Fetching it once and notifying, rather than once per screen, is both the
/// cheaper and the more consistent option (a pull-to-refresh on Home updates search results too).
class LibraryStore extends ChangeNotifier {
  LibraryStore() {
    WatchEvents.playerClosed.addListener(_onPlayerClosed);
  }

  @override
  void dispose() {
    WatchEvents.playerClosed.removeListener(_onPlayerClosed);
    super.dispose();
  }

  void _onPlayerClosed() {
    if (_data != null) refreshQuietly();
  }

  LibraryResponse? _data;
  Object? _error;
  bool _loading = false;

  LibraryResponse? get data => _data;
  Object? get error => _error;
  bool get loading => _loading;
  bool get hasData => _data != null;

  /// Every published folder and video in one list — what Search and Browse filter over.
  List<CatalogListItem> get allItems {
    final data = _data;
    if (data == null) return const [];
    return [...data.folders, ...data.videos];
  }

  Map<String, WatchProgress> get progressByFileId {
    final data = _data;
    if (data == null) return const {};
    return {
      for (final p in data.progress) p.fileId: p,
      for (final entry in data.continueWatching) entry.progress.fileId: entry.progress,
    };
  }

  /// Loads once; a second caller while a load is in flight (or after one succeeded) is a no-op.
  Future<void> ensureLoaded() async {
    if (_loading || _data != null) return;
    await refresh();
  }

  /// Re-fetches without the loading flicker — what runs when the player closes, so the progress
  /// you just made is on the cards you land back on. Keeps the old data if the fetch fails.
  Future<void> refreshQuietly() async {
    if (_loading) return;
    try {
      _data = await CatalogService.fetchLibrary();
      _error = null;
      notifyListeners();
    } catch (_) {
      // The data on screen is still valid, just slightly stale.
    }
  }

  Future<void> refresh() async {
    _loading = true;
    _error = null;
    notifyListeners();
    try {
      _data = await CatalogService.fetchLibrary();
    } catch (error) {
      _error = error;
    }
    _loading = false;
    notifyListeners();
  }
}
