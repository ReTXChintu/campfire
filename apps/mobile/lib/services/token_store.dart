import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Persists the session JWT in the platform keychain/keystore (not shared_preferences — this is a
/// credential, not app settings). Mirrors apps/frontend/src/lib/api.ts's localStorage token store,
/// just backed by something actually secure on mobile.
class TokenStore {
  TokenStore._();
  static const _storage = FlutterSecureStorage();
  static const _key = 'campfire_token';

  static Future<String?> read() => _storage.read(key: _key);
  static Future<void> write(String token) => _storage.write(key: _key, value: token);
  static Future<void> clear() => _storage.delete(key: _key);
}
