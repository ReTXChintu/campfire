import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../theme/app_theme.dart';
import '../../widgets/app_shell.dart';

/// The admin shell — its own left sidebar (Overview · Catalog · Requests) plus a way back to the
/// viewer app, wrapping every `/admin*` route.
///
/// **Windows only.** This widget is never reachable on Android: `app_router.dart`'s redirect
/// bounces any `/admin*` location unless `isDesktopAdminCapable` *and* the signed-in user is the
/// admin account, the viewer sidebar only renders its Admin group under the same pair of
/// conditions, and every `/api/admin/*` call is independently enforced server-side by
/// `requireAdmin`. Nothing here loosens any of that — it only reorganises the screens that were
/// already behind it (previously two bare pages reachable from a popup menu).
class AdminShell extends StatelessWidget {
  final Widget child;

  const AdminShell({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    final location = currentLocation(context).path;
    final width = MediaQuery.sizeOf(context).width;

    // Admin is a desktop surface, but a narrow window shouldn't strand it: below the sidebar
    // breakpoint the rail collapses and the pages stack, same rule as the viewer shell.
    if (!AppLayout.usesSidebar(width)) {
      return Scaffold(body: SafeArea(child: child));
    }

    return Scaffold(
      body: Row(
        children: [
          Container(
            width: 232,
            color: AppColors.bgElevated,
            child: SafeArea(
              right: false,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(18, 18, 18, 6),
                    child: Text('ADMIN', style: AppTheme.display(fontSize: 24)),
                  ),
                  const Padding(
                    padding: EdgeInsets.fromLTRB(18, 0, 18, 14),
                    child: Text(
                      'Windows only',
                      style: TextStyle(color: AppColors.textTertiary, fontSize: 11),
                    ),
                  ),
                  Expanded(
                    child: ListView(
                      padding: const EdgeInsets.symmetric(horizontal: 10),
                      children: [
                        SidebarItem(
                          label: 'Overview',
                          icon: Icons.dashboard_outlined,
                          selected: location == '/admin',
                          onTap: () => context.go('/admin'),
                        ),
                        SidebarItem(
                          label: 'Catalog',
                          icon: Icons.inventory_2_outlined,
                          selected: location.startsWith('/admin/catalog') ||
                              location.startsWith('/admin/folder') ||
                              location.startsWith('/admin/video'),
                          onTap: () => context.go('/admin/catalog'),
                        ),
                        SidebarItem(
                          label: 'Requests',
                          icon: Icons.mark_email_unread_outlined,
                          selected: location.startsWith('/admin/requests'),
                          onTap: () => context.go('/admin/requests'),
                        ),
                      ],
                    ),
                  ),
                  const Divider(height: 1, color: AppColors.divider),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
                    child: SidebarItem(
                      label: 'Back to Campfire',
                      icon: Icons.arrow_back,
                      selected: false,
                      onTap: () => context.go('/'),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const VerticalDivider(width: 1, thickness: 1, color: AppColors.divider),
          Expanded(child: child),
        ],
      ),
    );
  }
}
