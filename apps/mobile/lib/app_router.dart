import 'package:go_router/go_router.dart';
import 'screens/folder_screen.dart';
import 'screens/library_screen.dart';
import 'screens/login_screen.dart';
import 'screens/watch_screen.dart';
import 'services/auth_service.dart';

/// No admin routes exist here at all — the admin catalog/converter screens are web-only (see
/// apps/frontend's /admin routes). This isn't a route guard hiding them; there is simply nothing
/// to hide, by design.
GoRouter buildRouter(AuthService auth) {
  return GoRouter(
    initialLocation: '/',
    refreshListenable: auth,
    redirect: (context, state) {
      final loggedIn = auth.status == AuthStatus.signedIn;
      final onLogin = state.matchedLocation == '/login';
      if (!loggedIn && !onLogin) return '/login';
      if (loggedIn && onLogin) return '/';
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
    ],
  );
}
