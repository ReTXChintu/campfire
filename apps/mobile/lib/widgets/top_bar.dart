import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../config.dart';
import '../platform_info.dart';
import '../services/auth_service.dart';
import '../services/watch_party_service.dart';
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
      title: Image.asset('assets/images/logo.png', height: 32),
      actions: [
        // Joining doesn't need a video open first — this looks up the party's own video and
        // navigates straight there (see _joinWatchPartyByCode). Starting a *new* party still needs
        // an actual video open (WatchPartyOverlay's "Start Watch Party", since a party is always
        // tied to whatever's currently playing).
        IconButton(
          icon: const Icon(Icons.group_add_outlined, color: Colors.white),
          tooltip: 'Join Watch Party',
          onPressed: () => _joinWatchPartyByCode(context),
        ),
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
            PopupMenuItem(
              enabled: false,
              child: Text('v$appVersion', style: const TextStyle(color: AppColors.textTertiary, fontSize: 11)),
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

Future<void> _joinWatchPartyByCode(BuildContext context) async {
  final controller = TextEditingController();
  final code = await showDialog<String>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      backgroundColor: AppColors.surface,
      title: const Text('Join Watch Party', style: TextStyle(color: Colors.white)),
      content: TextField(
        controller: controller,
        autofocus: true,
        style: const TextStyle(color: Colors.white),
        decoration: const InputDecoration(
          hintText: 'Paste party code or invite link',
          hintStyle: TextStyle(color: AppColors.textTertiary),
        ),
        onSubmitted: (value) => Navigator.of(dialogContext).pop(value),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(),
          child: const Text('Cancel'),
        ),
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(controller.text),
          child: const Text('Join'),
        ),
      ],
    ),
  );
  if (code == null) return;

  final partyId = WatchPartyService.extractPartyCode(code);
  if (partyId.isEmpty) return;

  try {
    // Looks up the party's own video rather than assuming any video is already open — this is the
    // whole point of a home-screen join entry point (see WatchPartyOverlay's identical redirect
    // for the same reason when a pasted code turns out to belong to a *different* video than the
    // one currently playing).
    final party = await WatchPartyService.getByCode(partyId);
    if (!context.mounted) return;
    context.push('/watch/${party.fileId}?party=$partyId');
  } catch (_) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Couldn't find that watch party — check the code and try again.")),
      );
    }
  }
}
