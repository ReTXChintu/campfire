import 'package:flutter/material.dart';
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

  @override
  void initState() {
    super.initState();
    _future = AdminCatalogService.fetchVideo(widget.fileId);
  }

  void _reload() => setState(() => _future = AdminCatalogService.fetchVideo(widget.fileId));

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
                      onChanged: _reload,
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
