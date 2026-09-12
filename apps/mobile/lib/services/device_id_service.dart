import 'dart:io';
import 'dart:math';
import 'package:shared_preferences/shared_preferences.dart';

/// Mirrors apps/frontend/src/lib/deviceId.ts — a stable id for this install, persisted across
/// restarts, used by watch parties to mint a per-device LiveKit identity
/// (`${role}-${userId}-${deviceId}`, see apps/backend/src/routes/watchParties.ts) instead of a
/// fixed-per-host or fresh-per-request one. Non-secret local state, so shared_preferences (not
/// flutter_secure_storage/token_store.dart) is the right fit.
class DeviceIdService {
  DeviceIdService._();
  static const _key = 'campfire_device_id';
  static String? _cached;

  static Future<String> getDeviceId() async {
    if (_cached != null) return _cached!;
    final prefs = await SharedPreferences.getInstance();
    var id = prefs.getString(_key);
    if (id == null) {
      id = _randomId();
      await prefs.setString(_key, id);
    }
    _cached = id;
    return id;
  }

  static String _randomId() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    return bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  }

  /// Shown to the user in the "join from this device too?" / main-vs-companion prompts — not a
  /// precise device model lookup (no device_info_plus dependency), just enough to tell two of your
  /// own devices apart at a glance.
  static String getDeviceLabel() {
    if (Platform.isAndroid) return 'Android device';
    if (Platform.isWindows) return 'Windows PC';
    if (Platform.isIOS) return 'iPhone/iPad';
    return Platform.operatingSystem;
  }

  /// Matches apps/backend/src/lib/watchPartySessions.ts's WatchPartyClientKind — drives the
  /// desktop-vs-mobile main/companion assignment rule in join-token.
  static String getClientKind() {
    if (Platform.isAndroid) return 'android';
    if (Platform.isIOS) return 'ios';
    if (Platform.isWindows) return 'windows';
    return 'android';
  }
}
