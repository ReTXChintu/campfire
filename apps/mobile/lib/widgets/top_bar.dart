import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../platform_info.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';

class TopBar extends StatelessWidget implements PreferredSizeWidget {
  final bool showBack;

  const TopBar({super.key, this.showBack = false});

  @override
  Size get preferredSize => const Size.fromHeight(56);

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthService>();

    return AppBar(
      automaticallyImplyLeading: showBack,
      titleSpacing: showBack ? 0 : 16,
      title: RichText(
        text: TextSpan(
          style: AppTheme.display(fontSize: 24),
          children: const [TextSpan(text: 'CAMPFIRE'), TextSpan(text: '•', style: TextStyle(color: AppColors.accent))],
        ),
      ),
      actions: [
        PopupMenuButton<String>(
          icon: Container(
            width: 30,
            height: 30,
            margin: const EdgeInsets.only(right: 12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(6),
              gradient: const LinearGradient(colors: [AppColors.accent, AppColors.amber]),
            ),
          ),
          color: AppColors.surface,
          onSelected: (value) {
            if (value == 'signout') auth.signOut();
            if (value == 'admin') context.push('/admin');
          },
          itemBuilder: (context) => [
            PopupMenuItem(
              enabled: false,
              child: Text(auth.user?.email ?? '', style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
            ),
            // Windows + the seeded admin account only — see app_router.dart's redirect, which is
            // the actual guard; this entry is just a shortcut, not itself a security boundary.
            if (isDesktopAdminCapable && (auth.user?.isAdmin ?? false))
              const PopupMenuItem(value: 'admin', child: Text('Admin')),
            const PopupMenuItem(value: 'signout', child: Text('Sign out')),
          ],
        ),
      ],
    );
  }
}
