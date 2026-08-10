import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'api_client.dart';
import 'token_store.dart';

class CurrentUser {
  final String userId;
  final String email;
  final String? name;
  final String? avatarUrl;

  const CurrentUser({required this.userId, required this.email, this.name, this.avatarUrl});

  factory CurrentUser.fromJson(Map<String, dynamic> json) => CurrentUser(
    userId: json['userId'] as String,
    email: json['email'] as String,
    name: json['name'] as String?,
    avatarUrl: json['avatarUrl'] as String?,
  );
}

enum AuthStatus { unknown, signedOut, signedIn }

/// Google Sign-In happens natively on-device (no browser redirect) — the resulting ID token is
/// exchanged for our own session JWT via POST /auth/google/mobile (see apps/backend's routes/auth.ts),
/// the same JWT format/secret the web app's OAuth-callback flow issues. There is deliberately no
/// admin concept surfaced here — the mobile app has no admin screens at all (see project README).
class AuthService extends ChangeNotifier {
  final _googleSignIn = GoogleSignIn(scopes: ['email', 'profile']);

  AuthStatus status = AuthStatus.unknown;
  CurrentUser? user;
  String? error;

  Future<void> init() async {
    final token = await TokenStore.read();
    if (token == null) {
      status = AuthStatus.signedOut;
      notifyListeners();
      return;
    }
    await _loadCurrentUser();
  }

  Future<void> _loadCurrentUser() async {
    try {
      final data = await ApiClient.get('/auth/me') as Map<String, dynamic>;
      user = CurrentUser.fromJson(data);
      status = AuthStatus.signedIn;
    } catch (_) {
      // Token missing/expired/rejected — fall back to signed-out rather than an infinite loader.
      await TokenStore.clear();
      status = AuthStatus.signedOut;
    }
    notifyListeners();
  }

  Future<void> signIn() async {
    error = null;
    notifyListeners();
    try {
      final account = await _googleSignIn.signIn();
      if (account == null) return; // user cancelled the picker

      final googleAuth = await account.authentication;
      final idToken = googleAuth.idToken;
      if (idToken == null) throw Exception('Google did not return an ID token');

      final data = await ApiClient.post('/auth/google/mobile', {'idToken': idToken}) as Map<String, dynamic>;
      await TokenStore.write(data['token'] as String);
      await _loadCurrentUser();
    } catch (e) {
      error = e.toString();
      notifyListeners();
    }
  }

  Future<void> signOut() async {
    await _googleSignIn.signOut();
    await TokenStore.clear();
    user = null;
    status = AuthStatus.signedOut;
    notifyListeners();
  }
}
