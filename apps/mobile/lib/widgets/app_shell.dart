import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../config.dart';
import '../platform_info.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';
import 'tv_focusable.dart';

/// The app shell: **bottom navigation on a phone, a persistent left sidebar on Windows and
/// Android TV**, chosen purely by available width ([AppLayout.sidebarBreakpoint]) so a resized
/// desktop window and a tablet both land somewhere sensible.
///
/// This replaces the old single endless-rail `LibraryScreen` plus the avatar `PopupMenuButton`
/// that hid the email, the version, sign out and the admin links — the specific thing users
/// complained about. Those all live in real destinations now (Profile, and the Windows-only admin
/// shell).
///
/// Admin entries appear here only when [isDesktopAdminCapable] *and* the signed-in user is the
/// admin account — the same pair of conditions `app_router.dart`'s redirect enforces, which is the
/// actual guard. Android never renders them, by design.
class AppShell extends StatelessWidget {
  final StatefulNavigationShell navigationShell;

  const AppShell({super.key, required this.navigationShell});

  /// Branch indexes, in the order `app_router.dart` registers them.
  static const branchHome = 0;
  static const branchSearch = 1;
  static const branchBrowse = 2;
  static const branchRequests = 3;
  static const branchProfile = 4;

  void _goBranch(int index) {
    navigationShell.goBranch(index, initialLocation: index == navigationShell.currentIndex);
  }

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final body = navigationShell;

    if (AppLayout.usesSidebar(width)) {
      return Scaffold(
        body: Row(
          children: [
            _Sidebar(
              currentBranch: navigationShell.currentIndex,
              onSelectBranch: _goBranch,
            ),
            const VerticalDivider(width: 1, thickness: 1, color: AppColors.divider),
            Expanded(child: body),
          ],
        ),
      );
    }

    return Scaffold(
      body: body,
      bottomNavigationBar: _BottomNav(
        currentBranch: navigationShell.currentIndex,
        onSelectBranch: _goBranch,
      ),
    );
  }
}

/// Phone navigation — four destinations, 48dp minimum targets, the accent bar above the active
/// one. The browse grid shares the Home destination's highlight: you only ever reach it from a
/// rail's "See all", so pretending it's a fifth tab would be a lie about the IA.
class _BottomNav extends StatelessWidget {
  final int currentBranch;
  final ValueChanged<int> onSelectBranch;

  const _BottomNav({required this.currentBranch, required this.onSelectBranch});

  @override
  Widget build(BuildContext context) {
    const items = <_NavEntry>[
      _NavEntry('Home', Icons.home_outlined, Icons.home, AppShell.branchHome),
      _NavEntry('Search', Icons.search_outlined, Icons.search, AppShell.branchSearch),
      _NavEntry('Requests', Icons.auto_awesome_outlined, Icons.auto_awesome, AppShell.branchRequests),
      _NavEntry('Profile', Icons.person_outline, Icons.person, AppShell.branchProfile),
    ];

    final effective = currentBranch == AppShell.branchBrowse ? AppShell.branchHome : currentBranch;

    return Container(
      decoration: const BoxDecoration(
        color: AppColors.bgElevated,
        border: Border(top: BorderSide(color: AppColors.divider)),
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 66,
          child: Row(
            children: [
              for (final item in items)
                Expanded(
                  child: _BottomNavItem(
                    entry: item,
                    selected: effective == item.branch,
                    onTap: () => onSelectBranch(item.branch),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavEntry {
  final String label;
  final IconData icon;
  final IconData activeIcon;
  final int branch;
  const _NavEntry(this.label, this.icon, this.activeIcon, this.branch);
}

class _BottomNavItem extends StatelessWidget {
  final _NavEntry entry;
  final bool selected;
  final VoidCallback onTap;

  const _BottomNavItem({required this.entry, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final color = selected ? AppColors.accent : AppColors.textTertiary;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 5),
      child: TvFocusable(
        borderRadius: BorderRadius.circular(AppRadius.md),
        onTap: onTap,
        child: Semantics(
          button: true,
          selected: selected,
          label: entry.label,
          excludeSemantics: true,
          child: Stack(
            alignment: Alignment.center,
            children: [
              Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(selected ? entry.activeIcon : entry.icon, size: 23, color: color),
                  const SizedBox(height: 3),
                  Text(
                    entry.label,
                    style: TextStyle(color: color, fontSize: 10.5, fontWeight: FontWeight.w600),
                  ),
                ],
              ),
              if (selected)
                Positioned(
                  top: 0,
                  child: Container(
                    width: 26,
                    height: 3,
                    decoration: const BoxDecoration(
                      color: AppColors.accent,
                      borderRadius: BorderRadius.vertical(bottom: Radius.circular(3)),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Windows / Android TV navigation — a 232px rail, exactly as the approved desktop prototype:
/// brand, the viewer destinations, a Series/Movies pair that deep-links into the browse grid, an
/// Admin group on Windows only, then the account footer.
class _Sidebar extends StatelessWidget {
  final int currentBranch;
  final ValueChanged<int> onSelectBranch;

  const _Sidebar({required this.currentBranch, required this.onSelectBranch});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthService>();
    final location = currentLocation(context);
    final browseType = location.queryParameters['type'];
    final onBrowse = currentBranch == AppShell.branchBrowse;
    final showAdmin = isDesktopAdminCapable && (auth.user?.isAdmin ?? false);
    final adminLocation = location.path.startsWith('/admin') ? location.path : null;

    return Container(
      width: 232,
      color: AppColors.bgElevated,
      child: SafeArea(
        right: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 18, 18, 14),
              child: Row(
                children: [
                  Image.asset('assets/images/logo.png', height: 26),
                  const SizedBox(width: 9),
                  Text('CAMPFIRE', style: AppTheme.display(fontSize: 24)),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(horizontal: 10),
                children: [
                  SidebarItem(
                    label: 'Home',
                    icon: Icons.home_outlined,
                    selected: currentBranch == AppShell.branchHome,
                    onTap: () => onSelectBranch(AppShell.branchHome),
                  ),
                  SidebarItem(
                    label: 'Search',
                    icon: Icons.search,
                    selected: currentBranch == AppShell.branchSearch,
                    onTap: () => onSelectBranch(AppShell.branchSearch),
                  ),
                  SidebarItem(
                    label: 'Series',
                    icon: Icons.live_tv_outlined,
                    selected: onBrowse && browseType == 'series',
                    onTap: () => context.go('/browse?type=series'),
                  ),
                  SidebarItem(
                    label: 'Movies',
                    icon: Icons.movie_outlined,
                    selected: onBrowse && browseType == 'movies',
                    onTap: () => context.go('/browse?type=movies'),
                  ),
                  SidebarItem(
                    label: 'Requests',
                    icon: Icons.auto_awesome_outlined,
                    selected: currentBranch == AppShell.branchRequests,
                    onTap: () => onSelectBranch(AppShell.branchRequests),
                  ),
                  if (showAdmin) ...[
                    const _SidebarGroupLabel('Admin'),
                    SidebarItem(
                      label: 'Overview',
                      icon: Icons.dashboard_outlined,
                      selected: adminLocation == '/admin',
                      onTap: () => context.go('/admin'),
                    ),
                    SidebarItem(
                      label: 'Catalog',
                      icon: Icons.inventory_2_outlined,
                      selected: adminLocation == '/admin/catalog',
                      onTap: () => context.go('/admin/catalog'),
                    ),
                    SidebarItem(
                      label: 'Requests',
                      icon: Icons.mark_email_unread_outlined,
                      selected: adminLocation == '/admin/requests',
                      onTap: () => context.go('/admin/requests'),
                    ),
                  ],
                ],
              ),
            ),
            const Divider(height: 1, color: AppColors.divider),
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
              child: SidebarItem(
                label: auth.user?.name?.isNotEmpty == true ? auth.user!.name! : 'Profile',
                subtitle: 'v$appVersion',
                icon: Icons.person_outline,
                selected: currentBranch == AppShell.branchProfile,
                onTap: () => onSelectBranch(AppShell.branchProfile),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SidebarGroupLabel extends StatelessWidget {
  final String label;
  const _SidebarGroupLabel(this.label);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(11, 18, 11, 6),
      child: Text(
        label.toUpperCase(),
        style: const TextStyle(
          color: AppColors.textTertiary,
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 1.3,
        ),
      ),
    );
  }
}

/// The full current location, query string included. Read from the router delegate rather than
/// `GoRouterState.of(context)`: inside a shell builder that state belongs to the shell route, and
/// the sidebar needs the leaf route's `?type=` to know whether Series or Movies is active.
Uri currentLocation(BuildContext context) =>
    GoRouter.of(context).routerDelegate.currentConfiguration.uri;

/// One sidebar row. Also used by the admin shell so both rails look and focus identically.
class SidebarItem extends StatelessWidget {
  final String label;
  final String? subtitle;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;
  final int? count;

  const SidebarItem({
    super.key,
    required this.label,
    required this.icon,
    required this.selected,
    required this.onTap,
    this.subtitle,
    this.count,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 2),
      child: TvFocusable(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        onTap: onTap,
        child: Semantics(
          button: true,
          selected: selected,
          label: label,
          excludeSemantics: true,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 10),
            decoration: BoxDecoration(
              color: selected ? AppColors.accentSoft : Colors.transparent,
              borderRadius: BorderRadius.circular(AppRadius.sm),
              border: Border(
                left: BorderSide(
                  color: selected ? AppColors.accent : Colors.transparent,
                  width: 3,
                ),
              ),
            ),
            child: Row(
              children: [
                Icon(icon, size: 19, color: selected ? AppColors.foreground : AppColors.textSecondary),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: selected ? AppColors.foreground : AppColors.textSecondary,
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      if (subtitle != null)
                        Text(
                          subtitle!,
                          style: const TextStyle(color: AppColors.textTertiary, fontSize: 11),
                        ),
                    ],
                  ),
                ),
                if (count != null && count! > 0)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
                    decoration: BoxDecoration(
                      color: AppColors.accent,
                      borderRadius: BorderRadius.circular(AppRadius.pill),
                    ),
                    child: Text(
                      '$count',
                      style: const TextStyle(
                        color: AppColors.onAccent,
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The content header every pane inside the shell starts with: a display title, an optional
/// subtitle and trailing actions. On a phone it stands in for the old top bar; on desktop it sits
/// to the right of the sidebar. Full width, 16px gutters on phone and 28px on desktop — never a
/// centred column.
class PaneHeader extends StatelessWidget {
  final String title;
  final String? subtitle;
  final List<Widget> actions;
  final Widget? bottom;
  final bool showBack;

  const PaneHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.actions = const [],
    this.bottom,
    this.showBack = false,
  });

  @override
  Widget build(BuildContext context) {
    final gutter = AppLayout.gutter(MediaQuery.sizeOf(context).width);
    return Container(
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.divider)),
      ),
      child: SafeArea(
        bottom: false,
        child: Column(
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(showBack ? 4 : gutter, 10, gutter, 10),
              child: Row(
                children: [
                  if (showBack)
                    IconButton(
                      tooltip: 'Back',
                      icon: const Icon(Icons.arrow_back, color: AppColors.foreground),
                      // A pane can be reached either by a push (the detail screens) or by
                      // switching shell destination (the browse grid from a rail's "See all"),
                      // and only the former has anything to pop.
                      onPressed: () => context.canPop() ? context.pop() : context.go('/'),
                    ),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(title, style: AppTheme.display(fontSize: 26)),
                        if (subtitle != null)
                          Text(
                            subtitle!,
                            style: const TextStyle(color: AppColors.textTertiary, fontSize: 12),
                          ),
                      ],
                    ),
                  ),
                  ...actions,
                ],
              ),
            ),
            ?bottom,
          ],
        ),
      ),
    );
  }
}
