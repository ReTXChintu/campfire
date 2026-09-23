import 'package:shared_preferences/shared_preferences.dart';

/// Persists a single "remembered Auto-mode ceiling height" per device — shared by both mobile
/// player (MediaKitVideoPlayer) so a known-weak device doesn't have to
/// rediscover its ceiling via a rough patch on every video. Mirrors the web player's
/// localStorage-based equivalent (kept in sync by hand, no shared code across TS/Dart).
class QualityPrefsService {
  QualityPrefsService._();
  static const _key = 'campfire_auto_quality_ceiling';

  /// The remembered ceiling height, or null if none is stored (or "Original" was remembered —
  /// nothing to clamp to, since Original is already the default starting point).
  static Future<int?> getCeiling() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getInt(_key);
  }

  /// Pass null to remember "Original" (clears any prior downscaled ceiling).
  static Future<void> setCeiling(int? height) async {
    final prefs = await SharedPreferences.getInstance();
    if (height == null) {
      await prefs.remove(_key);
    } else {
      await prefs.setInt(_key, height);
    }
  }
}
