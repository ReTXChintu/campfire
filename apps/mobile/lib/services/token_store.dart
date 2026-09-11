import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Persists the session JWT in the platform keychain/keystore (not shared_preferences — this is a
/// credential, not app settings). Mirrors apps/frontend/src/lib/api.ts's localStorage token store,
/// just backed by something actually secure on mobile.
class TokenStore {
  TokenStore._();
  static const _storage = FlutterSecureStorage();
  static const _key = 'campfire_token';

  static Future<String?> read() async {
    try {
      return await _storage.read(key: _key);
    } catch (_) {
      // Android's keystore-backed encryption is tied to the app's signing certificate — a
      // previously-stored value becomes permanently undecryptable (BadPaddingException) after a
      // debug/release signature mismatch reinstall, and the same class of failure can happen on a
      // real device too (OS-level keystore resets, some backup/restore flows). Without this,
      // AuthService.init() never catches the throw, `status` never leaves `unknown`, and the app
      // is stuck on its loading screen forever. Clear the now-unreadable entry so this doesn't
      // repeat on every future launch, and treat it the same as "no token stored".
      await clear().catchError((_) {});
      return null;
    }
  }

  static Future<void> write(String token) => _storage.write(key: _key, value: token);
  static Future<void> clear() => _storage.delete(key: _key);
}
