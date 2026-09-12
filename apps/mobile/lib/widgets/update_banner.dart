import 'dart:io';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../services/app_update_service.dart';
import '../theme/app_theme.dart';

/// Shown on the home screen when a newer released build exists than the one currently running —
/// see app_update_service.dart for why this needs to exist at all (no Play Store/app-store
/// auto-update on a side-loaded build). Dismissible for the current screen instance only; reappears
/// next app launch until the user actually updates.
class UpdateBanner extends StatefulWidget {
  const UpdateBanner({super.key});

  @override
  State<UpdateBanner> createState() => _UpdateBannerState();
}

class _UpdateBannerState extends State<UpdateBanner> {
  AppUpdateInfo? _info;
  bool _dismissed = false;

  @override
  void initState() {
    super.initState();
    AppUpdateService.fetchLatest().then((info) {
      if (mounted && AppUpdateService.isNewer(info.version, appVersion)) {
        setState(() => _info = info);
      }
    }).catchError((_) {
      // Best-effort — no update banner beats crashing the home screen over this.
    });
  }

  Future<void> _download() async {
    final info = _info;
    if (info == null) return;
    final url = Platform.isWindows ? info.windowsDownloadUrl : info.androidDownloadUrl;
    await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final info = _info;
    if (info == null || _dismissed) return const SizedBox.shrink();

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.accent.withValues(alpha: 0.12),
        border: Border.all(color: AppColors.accent.withValues(alpha: 0.3)),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          const Icon(Icons.system_update, color: AppColors.accent, size: 18),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'Campfire v${info.version} is available (you have v$appVersion).',
              style: const TextStyle(color: Colors.white, fontSize: 13),
            ),
          ),
          TextButton(onPressed: _download, child: const Text('Download')),
          IconButton(
            icon: const Icon(Icons.close, color: Colors.white54, size: 18),
            tooltip: 'Dismiss',
            onPressed: () => setState(() => _dismissed = true),
          ),
        ],
      ),
    );
  }
}
