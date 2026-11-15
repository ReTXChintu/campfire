import 'package:flutter/material.dart';

import '../../models/catalog.dart';
import '../../models/media_request.dart';
import '../../services/admin_requests_service.dart';
import '../../services/api_client.dart';
import '../../services/catalog_service.dart';
import '../../theme/app_theme.dart';
import '../../widgets/admin/admin_request_detail.dart';
import '../../widgets/request_poster.dart';
import '../../widgets/request_status_pill.dart';

/// Admin · Requests — the request queue. **Windows desktop only**: gated exactly like the other
/// admin screens (platform_info.dart's isDesktopAdminCapable, app_router.dart's redirect, and the
/// top-bar menu entry), on top of every `/api/admin/*` call being enforced server-side by
/// requireAdmin. The Android build never shows admin UI, by product decision — see AGENTS.md.
///
/// Full-bleed list + detail split (no centred column), stacking into one scroll when the window is
/// too narrow for two usable halves.
class AdminRequestsPage extends StatefulWidget {
  const AdminRequestsPage({super.key});

  @override
  State<AdminRequestsPage> createState() => _AdminRequestsPageState();
}

class _AdminRequestsPageState extends State<AdminRequestsPage> {
  // Only the three statuses that need no per-request decision — the server refuses 'declined' and
  // 'added' in bulk, since one owes a note and the other a catalog link.
  static const _bulkStatuses = [
    RequestStatus.newRequest,
    RequestStatus.planned,
    RequestStatus.sourcing,
  ];

  List<AdminMediaRequest> _requests = const [];
  RequestCounts _counts = const RequestCounts(<RequestStatus, int>{});
  List<CatalogListItem> _catalogItems = const [];
  final Set<String> _selected = {};
  RequestStatus? _filter;
  String? _selectedId;
  bool _loading = true;
  Object? _error;
  bool _bulkBusy = false;

  @override
  void initState() {
    super.initState();
    _load();
    _loadCatalog();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      // The filter is applied server-side so `counts` always describes the whole queue, not the
      // filtered slice — that's what the tabs need.
      final page = await AdminRequestsService.fetchAll(status: _filter);
      if (!mounted) return;
      setState(() {
        _requests = page.requests;
        _counts = page.counts;
        _loading = false;
        _selected.removeWhere((id) => !page.requests.any((r) => r.id == id));
        if (!page.requests.any((r) => r.id == _selectedId)) {
          _selectedId = page.requests.isEmpty ? null : page.requests.first.id;
        }
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  Future<void> _loadCatalog() async {
    try {
      final library = await CatalogService.fetchLibrary();
      if (!mounted) return;
      setState(() => _catalogItems = [...library.folders, ...library.videos]);
    } catch (_) {
      // The picker just stays empty; the rest of the queue still works.
    }
  }

  Future<void> _applyBulkStatus(RequestStatus status) async {
    if (_selected.isEmpty) return;
    setState(() => _bulkBusy = true);
    try {
      await AdminRequestsService.bulkStatus(_selected.toList(), status);
      if (!mounted) return;
      final count = _selected.length;
      setState(() {
        _bulkBusy = false;
        _selected.clear();
      });
      await _load();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('$count ${count == 1 ? "request" : "requests"} set to ${status.label}.')),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _bulkBusy = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  void _onSaved(AdminMediaRequest updated) {
    setState(() {
      _requests = _requests.map((r) => r.id == updated.id ? updated : r).toList();
    });
    // Counts and the current filter can both have moved under it.
    _refreshCounts();
  }

  Future<void> _refreshCounts() async {
    try {
      final counts = await AdminRequestsService.fetchCounts();
      if (!mounted) return;
      setState(() => _counts = counts);
    } catch (_) {
      // The tabs keep their last known numbers.
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Admin · Requests', style: AppTheme.display(fontSize: 20)),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh, color: Colors.white),
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _statusTabs(),
            if (_selected.isNotEmpty) ...[
              const SizedBox(height: 12),
              _bulkBar(),
            ],
            const SizedBox(height: 14),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _statusTabs() {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          _Tab(
            label: 'All',
            count: _counts.total,
            selected: _filter == null,
            onTap: () {
              setState(() => _filter = null);
              _load();
            },
          ),
          for (final status in RequestStatus.values) ...[
            const SizedBox(width: 6),
            _Tab(
              label: status.label,
              count: _counts[status],
              selected: _filter == status,
              color: requestStatusColor(status),
              onTap: () {
                setState(() => _filter = status);
                _load();
              },
            ),
          ],
        ],
      ),
    );
  }

  Widget _bulkBar() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.accentSoft,
        border: Border.all(color: AppColors.accent),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Text(
            '${_selected.length} selected',
            style: const TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w700),
          ),
          const SizedBox(width: 16),
          const Text(
            'Set status to',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5),
          ),
          const SizedBox(width: 8),
          for (final status in _bulkStatuses) ...[
            OutlinedButton(
              onPressed: _bulkBusy ? null : () => _applyBulkStatus(status),
              style: OutlinedButton.styleFrom(
                foregroundColor: requestStatusColor(status),
                side: BorderSide(color: requestStatusColor(status)),
                padding: const EdgeInsets.symmetric(horizontal: 12),
                minimumSize: const Size(0, 34),
              ),
              child: Text(status.label),
            ),
            const SizedBox(width: 8),
          ],
          const Spacer(),
          const Text(
            'Declined and Added are one at a time',
            style: TextStyle(color: AppColors.textTertiary, fontSize: 11.5),
          ),
          const SizedBox(width: 12),
          TextButton(
            onPressed: _bulkBusy ? null : () => setState(_selected.clear),
            child: const Text('Clear'),
          ),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading && _requests.isEmpty) return const Center(child: CircularProgressIndicator());
    if (_error != null && _requests.isEmpty) {
      final message = _error is ApiException ? (_error as ApiException).message : '$_error';
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text("Couldn't load the request queue: $message",
                style: const TextStyle(color: AppColors.textSecondary)),
            const SizedBox(height: 14),
            ElevatedButton(onPressed: _load, child: const Text('Try again')),
          ],
        ),
      );
    }

    final list = _list();
    final detail = _detail();

    return LayoutBuilder(
      builder: (context, constraints) {
        // Two usable halves need real width; below that the split stacks rather than squeezing.
        if (constraints.maxWidth < 1000) {
          return ListView(
            children: [
              list,
              const SizedBox(height: 18),
              detail,
            ],
          );
        }
        return Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(flex: 6, child: list),
            const SizedBox(width: 18),
            Expanded(flex: 4, child: detail),
          ],
        );
      },
    );
  }

  Widget _list() {
    if (_requests.isEmpty) {
      return Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'No requests with that status',
                style: TextStyle(color: AppColors.foreground, fontSize: 15, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 6),
              const Text(
                'When someone asks for a title it lands here with its reference link or image, so you '
                'can find the right release before you go looking for it.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5, height: 1.5),
              ),
              const SizedBox(height: 14),
              OutlinedButton(
                onPressed: () {
                  setState(() => _filter = null);
                  _load();
                },
                child: const Text('Show all statuses'),
              ),
            ],
          ),
        ),
      );
    }

    final allSelected = _selected.length == _requests.length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Checkbox(
              value: allSelected,
              onChanged: (value) => setState(() {
                _selected.clear();
                if (value == true) _selected.addAll(_requests.map((r) => r.id));
              }),
            ),
            Text(
              'Select all ${_requests.length}',
              style: const TextStyle(color: AppColors.textTertiary, fontSize: 12),
            ),
          ],
        ),
        const SizedBox(height: 4),
        Expanded(
          child: ListView.separated(
            itemCount: _requests.length,
            separatorBuilder: (context, index) => const SizedBox(height: 8),
            itemBuilder: (context, index) {
              final request = _requests[index];
              return _Row(
                request: request,
                selected: _selectedId == request.id,
                checked: _selected.contains(request.id),
                onTap: () => setState(() => _selectedId = request.id),
                onCheck: (value) => setState(() {
                  if (value == true) {
                    _selected.add(request.id);
                  } else {
                    _selected.remove(request.id);
                  }
                }),
              );
            },
          ),
        ),
      ],
    );
  }

  Widget _detail() {
    AdminMediaRequest? selected;
    for (final request in _requests) {
      if (request.id == _selectedId) {
        selected = request;
        break;
      }
    }
    if (selected == null) {
      return Container(
        alignment: Alignment.center,
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          border: Border.all(color: AppColors.dividerStrong),
          borderRadius: BorderRadius.circular(16),
        ),
        child: const Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Pick a request', style: TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w700)),
            SizedBox(height: 6),
            Text(
              'Its reference, its votes and the admin actions open here.',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5),
            ),
          ],
        ),
      );
    }

    return AdminRequestDetail(
      // Fresh state per row, so switching rows never carries the previous one's unsaved edits.
      key: ValueKey(selected.id),
      request: selected,
      catalogItems: _catalogItems,
      onSaved: _onSaved,
      onDeleted: () {
        setState(() => _selectedId = null);
        _load();
      },
    );
  }
}

class _Tab extends StatelessWidget {
  final String label;
  final int count;
  final bool selected;
  final Color? color;
  final VoidCallback onTap;

  const _Tab({
    required this.label,
    required this.count,
    required this.selected,
    required this.onTap,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    final accent = color ?? AppColors.accent;
    return TextButton(
      onPressed: onTap,
      style: TextButton.styleFrom(
        foregroundColor: selected ? AppColors.foreground : AppColors.textSecondary,
        padding: const EdgeInsets.symmetric(horizontal: 14),
        minimumSize: const Size(0, 38),
        shape: const RoundedRectangleBorder(),
        side: BorderSide(color: selected ? accent : Colors.transparent, width: 2),
        textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
      ),
      child: Row(
        children: [
          Text(label),
          const SizedBox(width: 6),
          Text('$count', style: const TextStyle(color: AppColors.textTertiary, fontSize: 12)),
        ],
      ),
    );
  }
}

class _Row extends StatelessWidget {
  final AdminMediaRequest request;
  final bool selected;
  final bool checked;
  final VoidCallback onTap;
  final ValueChanged<bool?> onCheck;

  const _Row({
    required this.request,
    required this.selected,
    required this.checked,
    required this.onTap,
    required this.onCheck,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: selected ? AppColors.accentSoft : AppColors.bgElevated,
          border: Border.all(color: selected ? AppColors.accent : AppColors.divider),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            Checkbox(value: checked, onChanged: onCheck),
            RequestPoster.ofAdmin(request, width: 44),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    request.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    [
                      if (request.requestedBy != null) request.requestedBy!.display,
                      if (request.year != null) '${request.year}',
                      if (request.type != null) request.type == 'series' ? 'Series' : 'Movie',
                      if (request.refImagePath != null) 'image' else if (request.refLink != null) 'link',
                    ].join(' · '),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: AppColors.textTertiary, fontSize: 12),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 10),
            Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('${request.wantCount}', style: AppTheme.display(fontSize: 17)),
                const Text(
                  'WANT',
                  style: TextStyle(color: AppColors.textTertiary, fontSize: 9, letterSpacing: 0.6),
                ),
              ],
            ),
            const SizedBox(width: 12),
            RequestStatusPill(request.status, dense: true),
          ],
        ),
      ),
    );
  }
}
