import 'package:flutter/material.dart';
import '../../models/admin_catalog.dart';
import '../../services/admin_catalog_service.dart';
import '../../services/api_client.dart';
import '../../theme/app_theme.dart';
import '../../widgets/admin/admin_artwork_panel.dart';
import '../../widgets/admin/admin_scan_button.dart';
import '../../widgets/admin/catalog_children_list.dart';
import '../../widgets/app_shell.dart';
import '../../widgets/ui_kit.dart';

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
    return Column(
      children: [
        PaneHeader(
          title: 'Catalog',
          subtitle: 'Scan, curate, publish',
          actions: [
            IconButton(
              tooltip: 'Refresh',
              onPressed: _reload,
              icon: const Icon(Icons.refresh, color: AppColors.foreground),
            ),
          ],
        ),
        Expanded(
          child: FutureBuilder<AdminOverview>(
            future: _future,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const Padding(
                  padding: EdgeInsets.all(24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Shimmer(height: 44, radius: AppRadius.pill),
                      SizedBox(height: 18),
                      Shimmer(height: 120, radius: AppRadius.md),
                      SizedBox(height: 14),
                      Shimmer(height: 120, radius: AppRadius.md),
                    ],
                  ),
                );
              }
              if (snapshot.hasError) {
                final message = snapshot.error is ApiException
                    ? (snapshot.error as ApiException).message
                    : '${snapshot.error}';
                return ListView(
                  children: [
                    ErrorRetry(
                      title: "Couldn't load the catalog",
                      error: message,
                      onRetry: _reload,
                    ),
                  ],
                );
              }

              final data = snapshot.data!;
              // Full width, no centred max-width column — the pane uses the whole canvas the
              // admin sidebar leaves it.
              return ListView(
                padding: const EdgeInsets.fromLTRB(28, 18, 28, 32),
                children: [
                  const Text(
                    "Scan Drive to find new folders and videos, curate them, then publish so they "
                    "show up in the app. Curating alone doesn't make something visible to viewers "
                    "— Publish does.",
                    style: TextStyle(color: AppColors.textSecondary, height: 1.45),
                  ),
                  const SizedBox(height: 16),
                  Wrap(
                    spacing: 12,
                    runSpacing: 12,
                    children: [
                      AdminScanButton(onScanned: _reload),
                      AdminMatchArtworkButton(onMatched: _reload),
                    ],
                  ),
                  const SizedBox(height: 24),
                  if (data.pendingFolders.isNotEmpty || data.pendingVideos.isNotEmpty) ...[
                    Text(
                      'Needs curation (${data.pendingFolders.length + data.pendingVideos.length})',
                      style: AppTheme.display(fontSize: 22),
                    ),
                    const Divider(height: 24),
                    CatalogChildrenList(folders: data.pendingFolders, videos: data.pendingVideos),
                    const SizedBox(height: 24),
                  ],
                  if (data.unpublishedFolders.isNotEmpty || data.unpublishedVideos.isNotEmpty) ...[
                    Text(
                      'Ready to publish (${data.unpublishedFolders.length + data.unpublishedVideos.length})',
                      style: AppTheme.display(fontSize: 22),
                    ),
                    const Divider(height: 24),
                    CatalogChildrenList(
                      folders: data.unpublishedFolders,
                      videos: data.unpublishedVideos,
                    ),
                    const SizedBox(height: 24),
                  ],
                  Text('Library', style: AppTheme.display(fontSize: 22)),
                  const Divider(height: 24),
                  if (data.rootFolders.isEmpty && data.rootVideos.isEmpty)
                    const EmptyState(
                      icon: Icons.inventory_2_outlined,
                      title: 'Nothing published yet',
                      body: 'Curate something above and publish it to put it in front of viewers.',
                    )
                  else
                    CatalogChildrenList(folders: data.rootFolders, videos: data.rootVideos),
                ],
              );
            },
          ),
        ),
      ],
    );
  }
}
