import 'package:go_router/go_router.dart';
import 'platform_info.dart';
import 'screens/admin/admin_catalog_folder_page.dart';
import 'screens/admin/admin_catalog_page.dart';
import 'screens/admin/admin_catalog_video_page.dart';
import 'screens/folder_screen.dart';
import 'screens/library_screen.dart';
import 'screens/login_screen.dart';
import 'screens/watch_screen.dart';
import 'services/auth_service.dart';

/// Admin routes exist in this router now (they didn't when this app was Android/iOS-only — see
/// apps/frontend's /admin routes, previously the only place curation lived), but they're not
/// reachable outside Windows: the redirect below bounces any /admin* location back to the library
/// unless both isDesktopAdminCapable (this build is running on Windows) and the signed-in user is
/// actually the admin account. The routes are still registered unconditionally so GoRouter can
/// resolve-then-redirect a stray deep link rather than 404ing on it.
GoRouter buildRouter(AuthService auth) {
  return GoRouter(
    initialLocation: '/',
    refreshListenable: auth,
    redirect: (context, state) {
      final loggedIn = auth.status == AuthStatus.signedIn;
      final onLogin = state.matchedLocation == '/login';
      if (!loggedIn && !onLogin) return '/login';
      if (loggedIn && onLogin) return '/';

      final isAdminRoute = state.matchedLocation.startsWith('/admin');
      final canUseAdmin = isDesktopAdminCapable && (auth.user?.isAdmin ?? false);
      if (isAdminRoute && !canUseAdmin) return '/';

      return null;
    },
    routes: [
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
      GoRoute(path: '/', builder: (context, state) => const LibraryScreen()),
      GoRoute(
        path: '/folder/:folderId',
        builder: (context, state) => FolderScreen(folderId: state.pathParameters['folderId']!),
      ),
      GoRoute(
        path: '/watch/:fileId',
        builder: (context, state) => WatchScreen(fileId: state.pathParameters['fileId']!),
      ),
      GoRoute(path: '/admin', builder: (context, state) => const AdminCatalogPage()),
      GoRoute(
        path: '/admin/folder/:folderId',
        builder: (context, state) => AdminCatalogFolderPage(folderId: state.pathParameters['folderId']!),
      ),
      GoRoute(
        path: '/admin/video/:fileId',
        builder: (context, state) => AdminCatalogVideoPage(fileId: state.pathParameters['fileId']!),
      ),
    ],
  );
}
