import 'package:flutter/foundation.dart';
import '../models/catalog.dart';
import 'catalog_service.dart';

/// One in-memory copy of `GET /api/library`, shared by Home, Search and Browse.
///
/// Those three screens are separate navigation branches that all read the same library payload,
/// and there is **no search endpoint on the backend** — search and the browse grid filter this
/// list client-side. Fetching it once and notifying, rather than once per screen, is both the
/// cheaper and the more consistent option (a pull-to-refresh on Home updates search results too).
class LibraryStore extends ChangeNotifier {
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
    return {for (final entry in data.continueWatching) entry.progress.fileId: entry.progress};
  }

  /// Loads once; a second caller while a load is in flight (or after one succeeded) is a no-op.
  Future<void> ensureLoaded() async {
    if (_loading || _data != null) return;
    await refresh();
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
