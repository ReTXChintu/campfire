import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../models/admin_catalog.dart';
import '../../services/admin_catalog_service.dart';
import '../../services/api_client.dart';
import '../../theme/app_theme.dart';
import '../../widgets/admin/admin_video_curation_form.dart';

/// Mirrors apps/frontend/src/routes/admin/AdminCatalogVideoPage.tsx — thin wrapper that fetches
/// the video detail and hands it to AdminVideoCurationForm, the actual visual-parity target.
class AdminCatalogVideoPage extends StatefulWidget {
  final String fileId;
  const AdminCatalogVideoPage({super.key, required this.fileId});

  @override
  State<AdminCatalogVideoPage> createState() => _AdminCatalogVideoPageState();
}

class _AdminCatalogVideoPageState extends State<AdminCatalogVideoPage> {
  late Future<AdminVideoDetail> _future;
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    _future = AdminCatalogService.fetchVideo(widget.fileId);
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  void _reload() => setState(() => _future = AdminCatalogService.fetchVideo(widget.fileId));

  bool _deleting = false;
  String? _deleteError;

  // Mirrors AdminCatalogVideoPage.tsx's danger zone — confirm, then DELETE, then back to the
  // parent folder (the video no longer exists to stay on).
  Future<void> _confirmDelete(AdminVideoDetail data) async {
    final name = data.video.title ?? data.video.driveName;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Delete "$name"?'),
        content: const Text(
          "This moves the file to Drive's trash and removes it from Campfire along with its subtitles, "
          "everyone's watch progress on it, and its generated quality tiers. Drive keeps trashed files for "
          '30 days; everything else is gone immediately.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
          TextButton(
            style: TextButton.styleFrom(foregroundColor: AppColors.danger),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() {
      _deleting = true;
      _deleteError = null;
    });
    try {
      await AdminCatalogService.deleteVideo(widget.fileId);
      if (!mounted) return;
      final parentId = data.parentFolder?.id;
      context.go(parentId != null ? '/admin/folder/$parentId' : '/admin');
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _deleting = false;
        _deleteError = e is ApiException ? e.message : 'Delete failed';
      });
    }
  }

  // Mirrors useAdminVideo's refetchInterval on the web — keeps polling while any rendition
  // tier is still being generated in the background, so the status chips update on their own.
  void _scheduleRenditionPollIfNeeded(Map<String, RenditionEntry> renditions) {
    final inFlight = renditions.values.any((r) => r.status == 'queued' || r.status == 'processing');
    if (!inFlight) {
      _pollTimer?.cancel();
      _pollTimer = null;
      return;
    }
    _pollTimer ??= Timer.periodic(const Duration(seconds: 3), (_) {
      if (mounted) _reload();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Admin · Catalog')),
      body: FutureBuilder<AdminVideoDetail>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            final message = snapshot.error is ApiException ? (snapshot.error as ApiException).message : 'Not found';
            return Center(child: Text(message, style: const TextStyle(color: Color(0xFFF87171))));
          }

          final data = snapshot.data!;
          final title = data.video.title ?? data.video.driveName;
          final parentTitle = data.parentFolder?.title ?? data.parentFolder?.driveName;
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) _scheduleRenditionPollIfNeeded(data.video.renditions);
          });

          return SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 1100),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (parentTitle != null)
                      Text('Catalog / $parentTitle', style: const TextStyle(color: AppColors.textSecondary)),
                    const SizedBox(height: 12),
                    Text(title, style: AppTheme.display(fontSize: 32)),
                    const SizedBox(height: 20),
                    // key forces a fresh preview player/controllers whenever the underlying data
                    // reloads after a save/publish — mirrors watch_screen.dart's ValueKey pattern.
                    AdminVideoCurationForm(
                      key: ValueKey(widget.fileId),
                      fileId: widget.fileId,
                      driveName: data.video.driveName,
                      isMkv: data.video.isMkv,
                      initialTitle: data.video.title,
                      initialIntroStart: data.video.introStart,
                      initialIntroEnd: data.video.introEnd,
                      initialOutroStart: data.video.outroStart,
                      initialSubtitleSetIds: data.video.subtitleSetIds,
                      subtitleSetOptions: data.subtitleSetOptions,
                      status: data.video.status,
                      renditions: data.video.renditions,
                      onChanged: _reload,
                    ),
                    const SizedBox(height: 40),
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: AppColors.dangerSoft,
                        border: Border.all(color: AppColors.danger.withValues(alpha: 0.3)),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Danger zone',
                            style: TextStyle(color: AppColors.danger, fontWeight: FontWeight.w600, fontSize: 14),
                          ),
                          const SizedBox(height: 4),
                          const Text(
                            "Removes this video from Campfire and moves the file to Drive's trash. Its subtitles, "
                            "everyone's watch progress, and any generated quality tiers go with it.",
                            style: TextStyle(color: AppColors.textSecondary, fontSize: 14),
                          ),
                          if (_deleteError != null) ...[
                            const SizedBox(height: 8),
                            Text(_deleteError!, style: const TextStyle(color: AppColors.danger, fontSize: 14)),
                          ],
                          const SizedBox(height: 12),
                          OutlinedButton(
                            style: OutlinedButton.styleFrom(
                              foregroundColor: AppColors.danger,
                              side: BorderSide(color: AppColors.danger.withValues(alpha: 0.4)),
                            ),
                            onPressed: _deleting ? null : () => _confirmDelete(data),
                            child: Text(_deleting ? 'Deleting…' : 'Delete video'),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
