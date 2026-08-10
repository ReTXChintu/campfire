import 'package:flutter/foundation.dart';
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

/// One seeded admin account plus open signup for everyone else — POST /auth/login and
/// /auth/signup (both email+password) are the only ways in, same as the web app. There is
/// deliberately no admin concept surfaced beyond auth itself — the mobile app has no admin
/// screens at all (see project README), and signup never grants admin either way.
class AuthService extends ChangeNotifier {
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

  Future<void> signIn(String email, String password) async {
    error = null;
    notifyListeners();
    try {
      final data = await ApiClient.post('/auth/login', {
        'email': email,
        'password': password,
      }) as Map<String, dynamic>;
      await TokenStore.write(data['token'] as String);
      await _loadCurrentUser();
    } catch (e) {
      error = e is ApiException ? e.message : 'Sign-in failed — please try again.';
      notifyListeners();
    }
  }

  Future<void> signUp(String email, String password, String? name) async {
    error = null;
    notifyListeners();
    try {
      final data = await ApiClient.post('/auth/signup', {
        'email': email,
        'password': password,
        if (name != null && name.isNotEmpty) 'name': name,
      }) as Map<String, dynamic>;
      await TokenStore.write(data['token'] as String);
      await _loadCurrentUser();
    } catch (e) {
      error = e is ApiException ? e.message : 'Sign-up failed — please try again.';
      notifyListeners();
    }
  }

  Future<void> signOut() async {
    await TokenStore.clear();
    user = null;
    status = AuthStatus.signedOut;
    notifyListeners();
  }
}
