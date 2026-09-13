import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:media_kit/media_kit.dart';
import 'package:provider/provider.dart';
import 'package:window_manager/window_manager.dart';
import 'app_router.dart';
import 'platform_info.dart';
import 'services/auth_service.dart';
import 'services/media_session_service.dart';
import 'services/token_store.dart';
import 'theme/app_theme.dart';

// Debug-only dev convenience: `flutter run --dart-define=DEBUG_TOKEN=<jwt>` boots straight into
// an authenticated session, skipping the login screen — useful for UI work without typing
// credentials on every hot restart. Compiled out of release builds entirely via kDebugMode, so
// this never ships.
const _debugToken = String.fromEnvironment('DEBUG_TOKEN');

void main() async {
  // Registers libmpv bindings for the MKV player (see widgets/mkv_video_player.dart) — safe/cheap
  // to call even on platforms that never use it (e.g. this build running on iOS), and must happen
  // before any Player() is constructed.
  MediaKit.ensureInitialized();
  WidgetsFlutterBinding.ensureInitialized();
  // Windows only — lets MediaKitVideoPlayer's fullscreen button toggle the OS window itself
  // (there's no other window-level fullscreen concept on desktop). No-op/unused on every other
  // platform this app runs on (Android, and this build target in general).
  if (!kIsWeb && Platform.isWindows) {
    await windowManager.ensureInitialized();
  }
  // Android only (no-ops itself on every other platform) — see
  // services/media_session_service.dart.
  await MediaSessionService.init();
  // Android TV vs. phone/tablet can only be told apart at runtime — see platform_info.dart's
  // isAndroidTv. Must resolve before the router/UI can branch on it.
  await initAndroidTvDetection();
  if (kDebugMode && _debugToken.isNotEmpty) {
    await TokenStore.write(_debugToken);
  }
  runApp(
    ChangeNotifierProvider(
      create: (_) => AuthService()..init(),
      child: const CampfireApp(),
    ),
  );
}

class CampfireApp extends StatefulWidget {
  const CampfireApp({super.key});

  @override
  State<CampfireApp> createState() => _CampfireAppState();
}

class _CampfireAppState extends State<CampfireApp> {
  GoRouter? _router;

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthService>();

    if (auth.status == AuthStatus.unknown) {
      return MaterialApp(
        theme: AppTheme.dark,
        home: const Scaffold(body: Center(child: CircularProgressIndicator())),
      );
    }

    // Built once auth status first resolves, then reused — GoRouter shouldn't be recreated on
    // every AuthService notification (that would reset navigation state on every sign-in/out).
    _router ??= buildRouter(auth);

    return MaterialApp.router(
      title: 'Campfire',
      theme: AppTheme.dark,
      debugShowCheckedModeBanner: false,
      routerConfig: _router,
    );
  }
}
