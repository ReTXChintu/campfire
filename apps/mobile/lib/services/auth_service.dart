import 'package:flutter/foundation.dart';
import 'api_client.dart';
import 'token_store.dart';

class CurrentUser {
  final String userId;
  final String email;
  final String? name;
  final String? avatarUrl;
  final bool isAdmin;

  const CurrentUser({
    required this.userId,
    required this.email,
    this.name,
    this.avatarUrl,
    this.isAdmin = false,
  });

  factory CurrentUser.fromJson(Map<String, dynamic> json) => CurrentUser(
    userId: json['userId'] as String,
    email: json['email'] as String,
    name: json['name'] as String?,
    avatarUrl: json['avatarUrl'] as String?,
    isAdmin: json['isAdmin'] as bool? ?? false,
  );
}

enum AuthStatus { unknown, signedOut, signedIn }

/// One seeded admin account plus open signup for everyone else — POST /auth/login and
/// /auth/signup (both email+password) are the only ways in, same as the web app. `isAdmin` on
/// CurrentUser only ever matters on Windows, where it gates the admin routes (see app_router.dart
/// and platform_info.dart's isDesktopAdminCapable) — the Android build never surfaces it in the
/// UI, same as before. Signup never grants admin either way.
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

  /// Completes TV pairing-code login — the poll endpoint already minted the JWT the same way
  /// /auth/login does, so this just stores it and loads the profile, same as signIn/signUp's last
  /// two steps. See screens/tv_pairing_login_screen.dart.
  Future<void> signInWithToken(String token) async {
    await TokenStore.write(token);
    await _loadCurrentUser();
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
