import 'api_client.dart';

class AppUpdateInfo {
  final String version;
  final String androidDownloadUrl;
  final String windowsDownloadUrl;

  const AppUpdateInfo({
    required this.version,
    required this.androidDownloadUrl,
    required this.windowsDownloadUrl,
  });

  factory AppUpdateInfo.fromJson(Map<String, dynamic> json) => AppUpdateInfo(
        version: json['version'] as String,
        androidDownloadUrl: json['androidDownloadUrl'] as String,
        windowsDownloadUrl: json['windowsDownloadUrl'] as String,
      );
}

/// Side-loaded APK/Windows-installer builds have no Play Store/app-store auto-update — this is the
/// only signal a user gets that a newer released build exists. See
/// apps/backend/src/routes/appVersion.ts (which reports its own package.json version, kept in
/// lockstep with this app's pubspec.yaml by `npm run release`) and widgets/update_banner.dart.
class AppUpdateService {
  AppUpdateService._();

  static Future<AppUpdateInfo> fetchLatest() async {
    final data = await ApiClient.get('/api/app-version') as Map<String, dynamic>;
    return AppUpdateInfo.fromJson(data);
  }

  /// True if [remote] is a newer three-part (major.minor.patch) version than [current]. `current`
  /// is "dev" for anything not built by the release workflow (a plain `flutter run`) — nothing
  /// meaningful to compare there, so this always returns false for it.
  static bool isNewer(String remote, String current) {
    final r = _parse(remote);
    final c = _parse(current);
    if (r == null || c == null) return false;
    for (var i = 0; i < 3; i++) {
      if (r[i] != c[i]) return r[i] > c[i];
    }
    return false;
  }

  static List<int>? _parse(String value) {
    final parts = value.split('.');
    if (parts.length != 3) return null;
    final nums = <int>[];
    for (final part in parts) {
      final n = int.tryParse(part);
      if (n == null) return null;
      nums.add(n);
    }
    return nums;
  }
}
