import 'package:flutter/material.dart';
import '../../models/admin_catalog.dart';
import '../../services/admin_catalog_service.dart';
import '../../services/api_client.dart';
import '../../theme/app_theme.dart';
import '../../widgets/admin/admin_scan_button.dart';
import '../../widgets/admin/catalog_children_list.dart';

/// Mirrors apps/frontend/src/routes/admin/AdminCatalogPage.tsx — the admin panel's landing page.
/// Windows-only, see app_router.dart's redirect.
class AdminCatalogPage extends StatefulWidget {
  const AdminCatalogPage({super.key});

  @override
  State<AdminCatalogPage> createState() => _AdminCatalogPageState();
}

class _AdminCatalogPageState extends State<AdminCatalogPage> {
  late Future<AdminOverview> _future;

  @override
  void initState() {
    super.initState();
    _future = AdminCatalogService.fetchOverview();
  }

  void _reload() => setState(() => _future = AdminCatalogService.fetchOverview());

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Admin · Catalog', style: AppTheme.display(fontSize: 20))),
      body: FutureBuilder<AdminOverview>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            final message = snapshot.error is ApiException ? (snapshot.error as ApiException).message : '${snapshot.error}';
            return Center(child: Text('Failed to load: $message', style: const TextStyle(color: Color(0xFFF87171))));
          }

          final data = snapshot.data!;
          return SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 900),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Catalog', style: AppTheme.display(fontSize: 32)),
                    const SizedBox(height: 8),
                    const Text(
                      "Scan Drive to find new folders and videos, curate them, then publish so they show up in "
                      "the app. Curating alone doesn't make something visible to viewers — Publish does.",
                      style: TextStyle(color: AppColors.textSecondary),
                    ),
                    const SizedBox(height: 20),
                    AdminScanButton(onScanned: _reload),
                    const SizedBox(height: 24),
                    if (data.pendingFolders.isNotEmpty || data.pendingVideos.isNotEmpty) ...[
                      Text(
                        'Needs curation (${data.pendingFolders.length + data.pendingVideos.length})',
                        style: const TextStyle(color: AppColors.foreground, fontSize: 16, fontWeight: FontWeight.bold),
                      ),
                      const Divider(height: 24),
                      CatalogChildrenList(folders: data.pendingFolders, videos: data.pendingVideos),
                      const SizedBox(height: 24),
                    ],
                    if (data.unpublishedFolders.isNotEmpty || data.unpublishedVideos.isNotEmpty) ...[
                      Text(
                        'Ready to publish (${data.unpublishedFolders.length + data.unpublishedVideos.length})',
                        style: const TextStyle(color: AppColors.foreground, fontSize: 16, fontWeight: FontWeight.bold),
                      ),
                      const Divider(height: 24),
                      CatalogChildrenList(folders: data.unpublishedFolders, videos: data.unpublishedVideos),
                      const SizedBox(height: 24),
                    ],
                    const Text('Library', style: TextStyle(color: AppColors.foreground, fontSize: 16, fontWeight: FontWeight.bold)),
                    const Divider(height: 24),
                    CatalogChildrenList(folders: data.rootFolders, videos: data.rootVideos),
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
