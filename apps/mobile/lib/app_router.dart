import 'package:go_router/go_router.dart';
import 'platform_info.dart';
import 'screens/admin/admin_catalog_folder_page.dart';
import 'screens/admin/admin_catalog_page.dart';
import 'screens/admin/admin_catalog_video_page.dart';
import 'screens/admin/admin_overview_page.dart';
import 'screens/admin/admin_requests_page.dart';
import 'screens/admin/admin_shell.dart';
import 'screens/browse_screen.dart';
import 'screens/explore_screen.dart';
import 'screens/folder_screen.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'screens/profile_screen.dart';
import 'screens/requests_screen.dart';
import 'screens/search_screen.dart';
import 'screens/tv_pairing_login_screen.dart';
import 'screens/watch_screen.dart';
import 'services/auth_service.dart';
import 'widgets/app_shell.dart';

/// Admin routes exist in this router now (they didn't when this app was Android/iOS-only — see
/// apps/frontend's /admin routes, previously the only place curation lived), but they're not
/// reachable outside Windows: the redirect below bounces any /admin* location back to the library
/// unless both isDesktopAdminCapable (this build is running on Windows) and the signed-in user is
/// actually the admin account. The routes are still registered unconditionally so GoRouter can
/// resolve-then-redirect a stray deep link rather than 404ing on it.
///
/// Everything a signed-in viewer sees lives inside a [StatefulShellRoute] whose five branches are
/// the shell's destinations (see widgets/app_shell.dart: bottom navigation on a phone, a
/// persistent left sidebar on Windows/TV). An indexed stack, not a plain shell, so each
/// destination keeps its own scroll position, search text and navigation stack when you switch
/// away and back. The player and the admin surface sit outside it — the player wants the whole
/// screen, and admin has its own sidebar.
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
      // Android TV gets pairing-code login instead — no on-screen-keyboard password entry (see
      // isAndroidTv, tv_pairing_login_screen.dart).
      GoRoute(
        path: '/login',
        builder: (context, state) => isAndroidTv ? const TvPairingLoginScreen() : const LoginScreen(),
      ),

      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) => AppShell(navigationShell: navigationShell),
        branches: [
          // 0 — Home.
          StatefulShellBranch(
            routes: [GoRoute(path: '/', builder: (context, state) => const HomeScreen())],
          ),
          // 1 — Search.
          StatefulShellBranch(
            routes: [GoRoute(path: '/search', builder: (context, state) => const SearchScreen())],
          ),
          // 2 — Discover: the whole library as a grid, Series/Movies as chips. A Home rail's
          // "See all" lands here with `?type=series|movies` preselecting the chip.
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/discover',
                builder: (context, state) =>
                    BrowseScreen(
                      type: state.uri.queryParameters['type'],
                      genre: state.uri.queryParameters['genre'],
                    ),
              ),
            ],
          ),
          // 3 — Requests. `?request=<id>` comes from a fulfilled-request spotlight slide; see
          // widgets/spotlight_carousel.dart.
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/requests',
                builder: (context, state) =>
                    RequestsScreen(highlightRequestId: state.uri.queryParameters['request']),
              ),
            ],
          ),
          // 4 — Profile/Settings: everything the old avatar popup menu hid.
          StatefulShellBranch(
            routes: [GoRoute(path: '/profile', builder: (context, state) => const ProfileScreen())],
          ),
          // 5 — Explore: all of TMDb on the fisheye wall. Last in this list so the other branch
          // numbers stay put; the nav shows it next to Discover.
          StatefulShellBranch(
            routes: [GoRoute(path: '/explore', builder: (context, state) => const ExploreScreen())],
          ),
        ],
      ),

      // The old name of Discover; kept so nothing that still says /browse dead-ends.
      GoRoute(
        path: '/browse',
        redirect: (context, state) =>
            Uri(path: '/discover', queryParameters: state.uri.queryParameters.isEmpty ? null : state.uri.queryParameters)
                .toString(),
      ),

      // Outside the shell, pushed over it: the title/series detail, which is reachable from
      // Home, Search and Browse alike. Registering it at the top level (rather than under one
      // branch) is what lets any of those three push it without the push landing in another
      // branch's navigator; it carries its own back affordance (see folder_screen.dart's hero).
      GoRoute(
        path: '/folder/:folderId',
        builder: (context, state) => FolderScreen(folderId: state.pathParameters['folderId']!),
      ),

      // Outside the shell: the player owns the whole window/screen.
      GoRoute(
        path: '/watch/:fileId',
        builder: (context, state) => WatchScreen(
          fileId: state.pathParameters['fileId']!,
          partyId: state.uri.queryParameters['party'],
        ),
      ),

      // Windows + the admin account only (see the redirect above) — its own sidebar shell.
      ShellRoute(
        builder: (context, state, child) => AdminShell(child: child),
        routes: [
          GoRoute(path: '/admin', builder: (context, state) => const AdminOverviewPage()),
          GoRoute(path: '/admin/catalog', builder: (context, state) => const AdminCatalogPage()),
          GoRoute(path: '/admin/requests', builder: (context, state) => const AdminRequestsPage()),
          GoRoute(
            path: '/admin/folder/:folderId',
            builder: (context, state) =>
                AdminCatalogFolderPage(folderId: state.pathParameters['folderId']!),
          ),
          GoRoute(
            path: '/admin/video/:fileId',
            builder: (context, state) =>
                AdminCatalogVideoPage(fileId: state.pathParameters['fileId']!),
          ),
        ],
      ),
    ],
  );
}
