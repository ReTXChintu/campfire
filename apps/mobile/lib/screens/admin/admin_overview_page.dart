import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../models/admin_catalog.dart';
import '../../models/media_request.dart';
import '../../services/admin_catalog_service.dart';
import '../../services/admin_requests_service.dart';
import '../../theme/app_theme.dart';
import '../../widgets/admin/admin_scan_button.dart';
import '../../widgets/app_shell.dart';
import '../../widgets/tv_focusable.dart';
import '../../widgets/ui_kit.dart';

/// Admin Overview — the dashboard the old two-bare-tabs admin never had: what needs attention
/// now (curation backlog, unpublished items), how the rendition queue is doing, and how many
/// requests are waiting.
///
/// Every number comes from an endpoint that already exists: `GET /api/admin/catalog` (the
/// overview payload) and `GET /api/admin/requests/counts`. There is no storage-usage or
/// queue-depth endpoint, so the prototype's "storage" tile is deliberately absent rather than
/// filled with a plausible-looking fiction — see the report notes.
class AdminOverviewPage extends StatefulWidget {
  const AdminOverviewPage({super.key});

  @override
  State<AdminOverviewPage> createState() => _AdminOverviewPageState();
}

class _AdminOverviewPageState extends State<AdminOverviewPage> {
  AdminOverview? _catalog;
  RequestCounts? _requests;
  Object? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final catalog = await AdminCatalogService.fetchOverview();
      if (!mounted) return;
      setState(() {
        _catalog = catalog;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
      return;
    }
    try {
      final counts = await AdminRequestsService.fetchCounts();
      if (!mounted) return;
      setState(() => _requests = counts);
    } catch (_) {
      // The request tile just stays blank — the catalog half of this page is still useful.
    }
  }

  /// Rendition job health across the videos this payload carries. The backend exposes per-video
  /// rendition status but no aggregate queue endpoint, so this is a count of what's visible here,
  /// labelled as such.
  Map<String, int> get _renditionHealth {
    final counts = <String, int>{'queued': 0, 'processing': 0, 'done': 0, 'failed': 0};
    final videos = [
      ...?_catalog?.rootVideos,
      ...?_catalog?.unpublishedVideos,
      ...?_catalog?.pendingVideos,
    ];
    for (final video in videos) {
      for (final entry in video.renditions.values) {
        counts[entry.status] = (counts[entry.status] ?? 0) + 1;
      }
    }
    return counts;
  }

  @override
  Widget build(BuildContext context) {
    final gutter = AppLayout.gutter(MediaQuery.sizeOf(context).width);

    return Column(
      children: [
        PaneHeader(
          title: 'Overview',
          subtitle: 'Curation, publishing and the request queue',
          actions: [
            IconButton(
              tooltip: 'Refresh',
              onPressed: _loading ? null : _load,
              icon: const Icon(Icons.refresh, color: AppColors.foreground),
            ),
          ],
        ),
        Expanded(child: _body(context, gutter)),
      ],
    );
  }

  Widget _body(BuildContext context, double gutter) {
    if (_loading && _catalog == null) {
      return ListView(
        padding: EdgeInsets.all(gutter),
        children: const [
          Shimmer(height: 96, radius: AppRadius.md),
          SizedBox(height: 16),
          Shimmer(height: 96, radius: AppRadius.md),
          SizedBox(height: 16),
          Shimmer(height: 200, radius: AppRadius.md),
        ],
      );
    }
    if (_error != null && _catalog == null) {
      return ListView(
        children: [
          ErrorRetry(title: "Couldn't load the admin overview", error: _error, onRetry: _load),
        ],
      );
    }

    final data = _catalog!;
    final needsCuration = data.pendingFolders.length + data.pendingVideos.length;
    final readyToPublish = data.unpublishedFolders.length + data.unpublishedVideos.length;
    final health = _renditionHealth;
    final requests = _requests;

    return ListView(
      padding: EdgeInsets.fromLTRB(gutter, 16, gutter, 32),
      children: [
        _StatGrid(
          children: [
            _Stat(
              label: 'Needs curation',
              value: '$needsCuration',
              tone: needsCuration > 0 ? AppColors.accent : AppColors.foreground,
              onTap: () => context.go('/admin/catalog'),
            ),
            _Stat(
              label: 'Ready to publish',
              value: '$readyToPublish',
              tone: readyToPublish > 0 ? AppColors.amber : AppColors.foreground,
              onTap: () => context.go('/admin/catalog'),
            ),
            _Stat(label: 'Published folders', value: '${data.rootFolders.length}'),
            _Stat(label: 'Published videos', value: '${data.rootVideos.length}'),
          ],
        ),
        const SizedBox(height: 22),
        Row(
          children: [
            Expanded(child: Text('Requests', style: AppTheme.display(fontSize: 22))),
            TextButton(
              onPressed: () => context.go('/admin/requests'),
              child: const Text('Open the queue'),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (requests == null)
          const Text(
            'Request counts unavailable right now.',
            style: TextStyle(color: AppColors.textTertiary, fontSize: 12.5),
          )
        else
          _StatGrid(
            children: [
              for (final status in RequestStatus.values)
                _Stat(
                  label: status.label,
                  value: '${requests[status]}',
                  tone: switch (status) {
                    RequestStatus.newRequest => AppColors.accent,
                    RequestStatus.planned => AppColors.amber,
                    RequestStatus.sourcing => AppColors.textSecondary,
                    RequestStatus.added => AppColors.live,
                    RequestStatus.declined => AppColors.danger,
                  },
                  onTap: () => context.go('/admin/requests'),
                ),
            ],
          ),
        const FilmstripDivider(),
        Text('Rendition jobs', style: AppTheme.display(fontSize: 22)),
        const SizedBox(height: 4),
        const Text(
          'Across every video on this page — the backend reports rendition status per video, '
          'not as a queue, so this is a tally rather than a live job list.',
          style: TextStyle(color: AppColors.textTertiary, fontSize: 12, height: 1.4),
        ),
        const SizedBox(height: 12),
        _StatGrid(
          children: [
            _Stat(label: 'Queued', value: '${health['queued']}'),
            _Stat(label: 'Processing', value: '${health['processing']}', tone: AppColors.amber),
            _Stat(label: 'Done', value: '${health['done']}', tone: AppColors.live),
            _Stat(
              label: 'Failed',
              value: '${health['failed']}',
              tone: (health['failed'] ?? 0) > 0 ? AppColors.danger : AppColors.foreground,
            ),
          ],
        ),
        const SizedBox(height: 24),
        Text('Scan Drive', style: AppTheme.display(fontSize: 22)),
        const SizedBox(height: 4),
        const Text(
          'Finds new folders and videos in Drive. Curating alone does not make something visible '
          "to viewers — publishing does.",
          style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5, height: 1.45),
        ),
        const SizedBox(height: 12),
        Align(alignment: Alignment.centerLeft, child: AdminScanButton(onScanned: _load)),
      ],
    );
  }
}

/// Full-width responsive tile grid — no centred column anywhere in admin either.
class _StatGrid extends StatelessWidget {
  final List<Widget> children;
  const _StatGrid({required this.children});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = constraints.maxWidth >= 1100
            ? 4
            : constraints.maxWidth >= 720
                ? 3
                : 2;
        return GridView.count(
          crossAxisCount: columns,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          crossAxisSpacing: 14,
          mainAxisSpacing: 14,
          childAspectRatio: 2.1,
          children: children,
        );
      },
    );
  }
}

class _Stat extends StatelessWidget {
  final String label;
  final String value;
  final Color tone;
  final VoidCallback? onTap;

  const _Stat({
    required this.label,
    required this.value,
    this.tone = AppColors.foreground,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final tile = Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.bgElevated,
        border: Border.all(color: AppColors.divider),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            label.toUpperCase(),
            style: const TextStyle(
              color: AppColors.textTertiary,
              fontSize: 11,
              fontWeight: FontWeight.w700,
              letterSpacing: 1.1,
            ),
          ),
          const SizedBox(height: 6),
          Text(value, style: AppTheme.display(fontSize: 34, color: tone)),
        ],
      ),
    );

    if (onTap == null) return tile;
    return TvFocusable(
      borderRadius: BorderRadius.circular(AppRadius.md),
      onTap: onTap!,
      child: tile,
    );
  }
}
