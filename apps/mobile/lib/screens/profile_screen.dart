import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../platform_info.dart';
import '../services/app_update_service.dart';
import '../services/auth_service.dart';
import '../services/quality_prefs_service.dart';
import '../theme/app_theme.dart';
import '../widgets/app_shell.dart';
import '../widgets/join_party_action.dart';
import '../widgets/tv_focusable.dart';
import '../widgets/ui_kit.dart';

/// Profile / Settings — a real destination for everything the old avatar `PopupMenuButton` hid
/// (email, version, admin links, sign out), plus the playback preference the player already
/// persists and the TV pairing explanation.
///
/// Every row here maps to something that actually exists: the quality ceiling is
/// [QualityPrefsService] (the same value MediaKitVideoPlayer reads), the version check is
/// [AppUpdateService] / `GET /api/app-version`, pairing is the backend's `/auth/pair/*` flow. No
/// placeholder toggles.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  int? _ceiling;
  bool _ceilingLoaded = false;
  AppUpdateInfo? _update;
  bool _checkingUpdate = false;
  String? _updateMessage;

  /// `0` stands for "Original" (QualityPrefsService stores that as a null ceiling). The picker
  /// has to deal in a non-nullable value so a dismissed sheet — which also returns null — can't
  /// be mistaken for picking Original.
  static const _originalCeiling = 0;
  static const _ceilingOptions = <PickerOption<int>>[
    PickerOption(
      value: _originalCeiling,
      label: 'Original',
      detail: 'Always start at the source resolution',
    ),
    PickerOption(value: 1080, label: 'Up to 1080p', detail: 'Cap Auto mode at 1080p'),
    PickerOption(value: 720, label: 'Up to 720p', detail: 'Lighter on slow connections'),
    PickerOption(value: 480, label: 'Up to 480p', detail: 'Minimum data use'),
  ];

  @override
  void initState() {
    super.initState();
    QualityPrefsService.getCeiling().then((value) {
      if (!mounted) return;
      setState(() {
        _ceiling = value;
        _ceilingLoaded = true;
      });
    });
  }

  Future<void> _pickCeiling() async {
    final picked = await showOptionPicker<int>(
      context: context,
      title: 'Default quality',
      selected: _ceiling ?? _originalCeiling,
      options: _ceilingOptions,
    );
    // A dismissed sheet returns null and changes nothing; "Original" arrives as 0.
    if (picked == null || !mounted) return;
    final ceiling = picked == _originalCeiling ? null : picked;
    await QualityPrefsService.setCeiling(ceiling);
    if (!mounted) return;
    setState(() => _ceiling = ceiling);
  }

  Future<void> _checkForUpdate() async {
    setState(() {
      _checkingUpdate = true;
      _updateMessage = null;
    });
    try {
      final info = await AppUpdateService.fetchLatest();
      if (!mounted) return;
      final newer = AppUpdateService.isNewer(info.version, appVersion);
      setState(() {
        _update = newer ? info : null;
        _updateMessage = newer
            ? 'Campfire ${info.version} is available.'
            : "You're on the latest build.";
        _checkingUpdate = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _checkingUpdate = false;
        _updateMessage = "Couldn't reach the server to check.";
      });
    }
  }

  Future<void> _download() async {
    final info = _update;
    if (info == null) return;
    final url = !kIsWeb && Platform.isWindows ? info.windowsDownloadUrl : info.androidDownloadUrl;
    await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
  }

  Future<void> _confirmSignOut(AuthService auth) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppColors.bgElevated,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.lg)),
        title: const Text('Sign out?', style: TextStyle(color: AppColors.foreground)),
        content: const Text(
          'You will need your email and password to sign back in on this device.',
          style: TextStyle(color: AppColors.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Stay signed in'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Sign out'),
          ),
        ],
      ),
    );
    if (confirmed == true) await auth.signOut();
  }

  String get _ceilingLabel {
    if (!_ceilingLoaded) return '…';
    return _ceilingOptions.firstWhere((o) => o.value == (_ceiling ?? _originalCeiling)).label;
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthService>();
    final user = auth.user;
    final width = MediaQuery.sizeOf(context).width;
    final gutter = AppLayout.gutter(width);
    final showAdmin = isDesktopAdminCapable && (user?.isAdmin ?? false);
    final name = (user?.name?.isNotEmpty ?? false) ? user!.name! : (user?.email ?? 'Signed in');
    final initial = name.trim().isEmpty ? '?' : name.trim()[0].toUpperCase();

    return Column(
      children: [
        const PaneHeader(title: 'Profile'),
        Expanded(
          child: ListView(
            padding: EdgeInsets.only(bottom: 32, left: gutter, right: gutter),
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 18),
                child: Row(
                  children: [
                    Container(
                      width: 58,
                      height: 58,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(AppRadius.lg),
                        gradient: const LinearGradient(colors: [AppColors.accent, AppColors.amber]),
                      ),
                      child: Text(
                        initial,
                        style: AppTheme.display(fontSize: 26, color: AppColors.onAccent),
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            name,
                            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                          ),
                          if (user?.email != null)
                            Text(
                              user!.email,
                              style: const TextStyle(color: AppColors.textSecondary, fontSize: 12.5),
                            ),
                          if (user?.isAdmin ?? false)
                            const Padding(
                              padding: EdgeInsets.only(top: 4),
                              child: MetaBadge(label: 'ADMIN ACCOUNT'),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const _GroupLabel('Playback'),
              SettingsRow(
                icon: Icons.high_quality_outlined,
                title: 'Default quality',
                subtitle: 'Where Auto mode starts on this device',
                trailingLabel: _ceilingLabel,
                onTap: _pickCeiling,
              ),
              SettingsRow(
                icon: Icons.subtitles_outlined,
                title: 'Audio & subtitle tracks',
                subtitle: 'Chosen per title in the player; your last pick is remembered',
                enabled: false,
              ),
              const _GroupLabel('Devices'),
              SettingsRow(
                icon: Icons.tv_outlined,
                title: 'Watch on a TV',
                subtitle: isAndroidTv
                    ? 'This device is signed in via a pairing code'
                    : 'Install Campfire on your Android TV — it shows a pairing code you claim from here',
                onTap: () => _showPairingHelp(context),
              ),
              SettingsRow(
                icon: Icons.group_add_outlined,
                title: 'Join a watch party',
                subtitle: 'Enter a code someone shared with you',
                onTap: () => promptJoinWatchParty(context),
              ),
              const _GroupLabel('Library'),
              SettingsRow(
                icon: Icons.auto_awesome_outlined,
                title: 'My requests',
                subtitle: 'Titles you asked for, and where they got to',
                onTap: () => context.go('/requests'),
              ),
              if (showAdmin) ...[
                const _GroupLabel('Admin'),
                SettingsRow(
                  icon: Icons.dashboard_outlined,
                  title: 'Admin overview',
                  subtitle: 'Curation, publishing and the request queue',
                  onTap: () => context.go('/admin'),
                ),
              ],
              const _GroupLabel('About'),
              SettingsRow(
                icon: Icons.system_update_outlined,
                title: 'Version',
                subtitle: _updateMessage ??
                    'Side-loaded builds do not auto-update — check here for a newer one',
                trailingLabel: _checkingUpdate ? 'Checking…' : 'v$appVersion',
                onTap: _checkingUpdate ? null : _checkForUpdate,
              ),
              if (_update != null)
                Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: FilledButton.icon(
                    onPressed: _download,
                    icon: const Icon(Icons.download, size: 18),
                    label: Text('Download ${_update!.version}'),
                  ),
                ),
              const FilmstripDivider(),
              OutlinedButton.icon(
                onPressed: () => _confirmSignOut(auth),
                icon: const Icon(Icons.logout, size: 18),
                label: const Text('Sign out'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.danger,
                  side: const BorderSide(color: AppColors.danger),
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  void _showPairingHelp(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppColors.bgElevated,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.lg)),
        title: const Text('Watch on a TV', style: TextStyle(color: AppColors.foreground)),
        content: const Text(
          'Campfire on Android TV never asks for a password with the remote. It shows a short '
          'pairing code and a QR code instead — open that link on this phone or in a browser '
          'while signed in, and the TV signs itself in.',
          style: TextStyle(color: AppColors.textSecondary, height: 1.5),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Got it'),
          ),
        ],
      ),
    );
  }
}

class _GroupLabel extends StatelessWidget {
  final String label;
  const _GroupLabel(this.label);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(0, 20, 0, 6),
      child: Text(
        label.toUpperCase(),
        style: const TextStyle(
          color: AppColors.textTertiary,
          fontSize: 10.5,
          fontWeight: FontWeight.w700,
          letterSpacing: 1.3,
        ),
      ),
    );
  }
}

/// One settings row: 56dp minimum, leading icon, title + explanation, optional current value.
/// A row with no [onTap] is rendered as information, never as a tappable control that does
/// nothing.
class SettingsRow extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final String? trailingLabel;
  final VoidCallback? onTap;
  final bool enabled;

  const SettingsRow({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.trailingLabel,
    this.onTap,
    this.enabled = true,
  });

  @override
  Widget build(BuildContext context) {
    final interactive = enabled && onTap != null;
    final row = Container(
      constraints: const BoxConstraints(minHeight: 56),
      padding: const EdgeInsets.symmetric(vertical: 10),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.divider)),
      ),
      child: Row(
        children: [
          Icon(icon, size: 21, color: AppColors.textSecondary),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: AppColors.foreground,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (subtitle != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      subtitle!,
                      style: const TextStyle(
                        color: AppColors.textTertiary,
                        fontSize: 11.5,
                        height: 1.35,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          if (trailingLabel != null)
            Padding(
              padding: const EdgeInsets.only(left: 10),
              child: Text(
                trailingLabel!,
                style: const TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          if (interactive)
            const Padding(
              padding: EdgeInsets.only(left: 8),
              child: Icon(Icons.chevron_right, size: 18, color: AppColors.textTertiary),
            ),
        ],
      ),
    );

    if (!interactive) return row;
    return TvFocusable(
      borderRadius: BorderRadius.circular(AppRadius.sm),
      onTap: onTap!,
      child: row,
    );
  }
}
