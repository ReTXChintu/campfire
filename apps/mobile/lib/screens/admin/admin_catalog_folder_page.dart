import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../models/admin_catalog.dart';
import '../../services/admin_catalog_service.dart';
import '../../services/api_client.dart';
import '../../theme/app_theme.dart';
import '../../widgets/admin/admin_folder_title_form.dart';
import '../../widgets/admin/catalog_children_list.dart';

/// Mirrors apps/frontend/src/routes/admin/AdminCatalogFolderPage.tsx.
class AdminCatalogFolderPage extends StatefulWidget {
  final String folderId;
  const AdminCatalogFolderPage({super.key, required this.folderId});

  @override
  State<AdminCatalogFolderPage> createState() => _AdminCatalogFolderPageState();
}

class _AdminCatalogFolderPageState extends State<AdminCatalogFolderPage> {
  late Future<AdminFolderDetail> _future;

  @override
  void initState() {
    super.initState();
    _future = AdminCatalogService.fetchFolder(widget.folderId);
  }

  void _reload() => setState(() => _future = AdminCatalogService.fetchFolder(widget.folderId));

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Admin · Catalog')),
      body: FutureBuilder<AdminFolderDetail>(
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
          return SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 900),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Wrap(
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        GestureDetector(
                          onTap: () => context.go('/admin'),
                          child: const Text('Catalog', style: TextStyle(color: AppColors.textSecondary)),
                        ),
                        for (final crumb in data.breadcrumbs) ...[
                          const Text(' / ', style: TextStyle(color: AppColors.textTertiary)),
                          GestureDetector(
                            onTap: () => context.go('/admin/folder/${crumb.id}'),
                            child: Text(crumb.title ?? crumb.driveName, style: const TextStyle(color: AppColors.textSecondary)),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 12),
                    Text(data.folder.title ?? data.folder.driveName, style: AppTheme.display(fontSize: 32)),
                    const SizedBox(height: 20),
                    AdminFolderTitleForm(
                      folderId: widget.folderId,
                      initialTitle: data.folder.title,
                      driveName: data.folder.driveName,
                      status: data.folder.status,
                      onChanged: _reload,
                    ),
                    const SizedBox(height: 24),
                    const Text('Contents', style: TextStyle(color: AppColors.foreground, fontSize: 16, fontWeight: FontWeight.bold)),
                    const Divider(height: 24),
                    CatalogChildrenList(folders: data.childFolders, videos: data.childVideos),
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
