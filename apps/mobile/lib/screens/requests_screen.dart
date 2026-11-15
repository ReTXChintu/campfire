import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../models/catalog.dart';
import '../models/media_request.dart';
import '../services/api_client.dart';
import '../services/catalog_service.dart';
import '../services/requests_service.dart';
import '../theme/app_theme.dart';
import '../widgets/request_poster.dart';
import '../widgets/request_sheet.dart';
import '../widgets/request_status_pill.dart';
import '../widgets/tv_focusable.dart';

/// The requests board — `/requests`, on every platform. Two tabs: **Browse** (everyone's asks,
/// filterable by status, with the upvote that merges duplicates instead of letting them pile up)
/// and **My requests** (the same rows plus the status timeline and the admin's note back).
///
/// [highlightRequestId] comes from a spotlight slide's "See the request" link (see
/// widgets/spotlight_carousel.dart) — that request is pulled to the top of Browse and outlined.
class RequestsScreen extends StatefulWidget {
  final String? highlightRequestId;

  const RequestsScreen({super.key, this.highlightRequestId});

  @override
  State<RequestsScreen> createState() => _RequestsScreenState();
}

class _RequestsScreenState extends State<RequestsScreen> with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 2, vsync: this);

  List<MediaRequest>? _all;
  List<MediaRequest>? _mine;
  /// The published catalog, held only so the request form can warn "you already have this"
  /// without another endpoint. A failure here is silent — it's a nicety, not the flow.
  List<CatalogListItem> _libraryItems = const [];
  Object? _error;
  bool _loading = true;
  RequestStatus? _statusFilter;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        RequestsService.fetchAll(),
        RequestsService.fetchMine(),
      ]);
      if (!mounted) return;
      setState(() {
        _all = results[0];
        _mine = results[1];
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
    _loadLibrary();
  }

  Future<void> _loadLibrary() async {
    try {
      final library = await CatalogService.fetchLibrary();
      if (!mounted) return;
      setState(() => _libraryItems = [...library.folders, ...library.videos]);
    } catch (_) {
      // No library-dedupe warning in the form, then. Everything else still works.
    }
  }

  Future<void> _refresh() => _load();

  void _replace(MediaRequest updated) {
    setState(() {
      _all = _all?.map((r) => r.id == updated.id ? updated : r).toList();
      _mine = _mine?.map((r) => r.id == updated.id ? updated : r).toList();
    });
  }

  Future<void> _toggleUpvote(MediaRequest request) async {
    try {
      final updated = await RequestsService.upvote(request.id, wantsIt: !request.iWantIt);
      if (!mounted) return;
      _replace(updated);
    } on ApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  Future<void> _openForm({String? initialTitle}) async {
    final result = await showRequestSheet(
      context,
      initialTitle: initialTitle,
      libraryItems: _libraryItems,
    );
    if (result == null || !mounted) return;
    // Whether it was a new request or a vote on an existing one, both lists can have changed.
    await _load();
    if (!mounted) return;
    if (result.isMine) _tabs.animateTo(1);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          result.isMine
              ? '${result.title} is on the board.'
              : 'Counted — ${wantCountLabel(result.wantCount, youWantIt: result.iWantIt).toLowerCase()}.',
        ),
      ),
    );
  }

  Future<void> _withdraw(MediaRequest request) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: const Text('Withdraw this request?', style: TextStyle(color: Colors.white)),
        content: Text(
          '${request.title} will come off the board, along with anyone else\'s votes for it.',
          style: const TextStyle(color: AppColors.textSecondary),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Keep it')),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            style: TextButton.styleFrom(foregroundColor: AppColors.danger),
            child: const Text('Withdraw'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await RequestsService.remove(request.id);
      if (!mounted) return;
      await _load();
    } on ApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final mineCount = _mine?.length ?? 0;

    return Scaffold(
      appBar: AppBar(
        title: Text('Requests', style: AppTheme.display(fontSize: 22)),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: _loading ? null : _refresh,
            icon: const Icon(Icons.refresh, color: Colors.white),
          ),
        ],
        bottom: TabBar(
          controller: _tabs,
          indicatorColor: AppColors.accent,
          indicatorWeight: 3,
          labelColor: AppColors.foreground,
          unselectedLabelColor: AppColors.textTertiary,
          labelStyle: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700),
          tabs: [
            const Tab(text: 'Browse requests'),
            Tab(text: mineCount > 0 ? 'My requests ($mineCount)' : 'My requests'),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _openForm(),
        backgroundColor: AppColors.accent,
        foregroundColor: AppColors.onAccent,
        icon: const Icon(Icons.add),
        label: const Text('Request a title'),
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: TabBarView(
          controller: _tabs,
          children: [_browseTab(), _mineTab()],
        ),
      ),
    );
  }

  Widget _browseTab() {
    if (_loading && _all == null) return const Center(child: CircularProgressIndicator());
    if (_error != null && _all == null) return _errorView();

    final all = _all ?? const <MediaRequest>[];
    var rows = _statusFilter == null
        ? all.toList()
        : all.where((r) => r.status == _statusFilter).toList();
    // Most wanted first — the board's whole job is to show what the room agrees on.
    rows.sort((a, b) => b.wantCount.compareTo(a.wantCount));
    final highlighted = widget.highlightRequestId;
    if (highlighted != null) {
      final index = rows.indexWhere((r) => r.id == highlighted);
      if (index > 0) rows.insert(0, rows.removeAt(index));
    }

    return ListView(
      padding: const EdgeInsets.only(bottom: 96),
      children: [
        _statusFilters(all),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: Text(
            '${rows.length} ${rows.length == 1 ? "request" : "requests"}',
            style: const TextStyle(color: AppColors.textTertiary, fontSize: 12),
          ),
        ),
        if (rows.isEmpty)
          _EmptyState(
            title: _statusFilter == null ? 'Nothing on the board yet' : 'Nothing with that status',
            body: _statusFilter == null
                ? 'Be the first to ask for something — a title and a link is all it takes.'
                : 'Try another status filter.',
            actionLabel: 'Request a title',
            onAction: () => _openForm(),
          )
        else
          for (final request in rows)
            _BrowseCard(
              request: request,
              highlighted: request.id == highlighted,
              onUpvote: () => _toggleUpvote(request),
              onWatch: _watchTargetFor(request),
            ),
      ],
    );
  }

  Widget _mineTab() {
    if (_loading && _mine == null) return const Center(child: CircularProgressIndicator());
    if (_error != null && _mine == null) return _errorView();

    final mine = _mine ?? const <MediaRequest>[];
    return ListView(
      padding: const EdgeInsets.only(bottom: 96),
      children: [
        if (mine.isEmpty)
          _EmptyState(
            title: "You haven't asked for anything",
            body: 'Request a film or a series and you can follow it from New through to Added right here.',
            actionLabel: 'Request a title',
            onAction: () => _openForm(),
          )
        else
          for (final request in mine)
            _MineRow(
              request: request,
              onWatch: _watchTargetFor(request),
              onWithdraw: request.status == RequestStatus.added ? null : () => _withdraw(request),
            ),
      ],
    );
  }

  /// A fulfilled request links straight at whatever it was fulfilled with — a folder lands on its
  /// detail screen, a single video goes straight to the player.
  VoidCallback? _watchTargetFor(MediaRequest request) {
    final ref = request.catalogRef;
    if (request.status != RequestStatus.added || ref == null) return null;
    final href = ref.kind == 'folder' ? '/folder/${ref.id}' : '/watch/${ref.id}';
    return () => context.push(href);
  }

  Widget _statusFilters(List<MediaRequest> all) {
    final counts = <RequestStatus, int>{};
    for (final request in all) {
      counts[request.status] = (counts[request.status] ?? 0) + 1;
    }

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Row(
        children: [
          _FilterChip(
            label: 'All',
            count: all.length,
            selected: _statusFilter == null,
            onTap: () => setState(() => _statusFilter = null),
          ),
          for (final status in RequestStatus.values) ...[
            const SizedBox(width: 8),
            _FilterChip(
              label: status.label,
              count: counts[status] ?? 0,
              selected: _statusFilter == status,
              color: requestStatusColor(status),
              onTap: () => setState(() => _statusFilter = status),
            ),
          ],
        ],
      ),
    );
  }

  Widget _errorView() {
    final message = _error is ApiException ? (_error as ApiException).message : '$_error';
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        Text("Couldn't load the requests board: $message",
            style: const TextStyle(color: AppColors.textSecondary)),
        const SizedBox(height: 16),
        Align(
          alignment: Alignment.centerLeft,
          child: ElevatedButton(onPressed: _refresh, child: const Text('Try again')),
        ),
      ],
    );
  }
}

class _FilterChip extends StatelessWidget {
  final String label;
  final int count;
  final bool selected;
  final Color? color;
  final VoidCallback onTap;

  const _FilterChip({
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
        backgroundColor: selected ? accent : AppColors.bgElevated,
        foregroundColor: selected ? AppColors.onAccent : AppColors.textSecondary,
        side: BorderSide(color: selected ? accent : AppColors.dividerStrong),
        shape: const StadiumBorder(),
        padding: const EdgeInsets.symmetric(horizontal: 14),
        minimumSize: const Size(0, 36),
        textStyle: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
      ),
      child: Text('$label · $count'),
    );
  }
}

class _BrowseCard extends StatelessWidget {
  final MediaRequest request;
  final bool highlighted;
  final VoidCallback onUpvote;
  final VoidCallback? onWatch;

  const _BrowseCard({
    required this.request,
    required this.highlighted,
    required this.onUpvote,
    this.onWatch,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      decoration: BoxDecoration(
        color: highlighted ? AppColors.accentSoft : null,
        border: Border(
          bottom: const BorderSide(color: AppColors.divider),
          left: BorderSide(
            color: highlighted ? AppColors.accent : Colors.transparent,
            width: 3,
          ),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          RequestPoster.of(request),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  request.title,
                  style: const TextStyle(color: AppColors.foreground, fontSize: 14, height: 1.3, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 5),
                _MetaLine(request: request),
                if (request.adminNote != null) ...[
                  const SizedBox(height: 9),
                  _AdminNote(note: request.adminNote!),
                ],
                if (onWatch != null) ...[
                  const SizedBox(height: 10),
                  ElevatedButton.icon(
                    onPressed: onWatch,
                    icon: const Icon(Icons.play_arrow, size: 18),
                    label: const Text('Watch it now'),
                    style: ElevatedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: 10),
          _VoteButton(request: request, onTap: onUpvote),
        ],
      ),
    );
  }
}

/// Status, the requester, and which kind of reference came with it. `type` and `year` are usually
/// null (no TMDB key, or an image-only request) and are shown only when the server actually sent
/// them — never as a "Movie"/"Unknown" placeholder.
class _MetaLine extends StatelessWidget {
  final MediaRequest request;

  const _MetaLine({required this.request});

  @override
  Widget build(BuildContext context) {
    final bits = <String>[
      if (request.year != null) '${request.year}',
      if (request.type != null) request.type == 'series' ? 'Series' : 'Movie',
      if (request.requestedByName != null) 'asked by ${request.requestedByName}',
      if (request.refImagePath != null) 'poster attached' else if (request.refLink != null) 'reference link',
    ];

    return Wrap(
      spacing: 8,
      runSpacing: 6,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        RequestStatusPill(request.status, dense: true),
        if (bits.isNotEmpty)
          Text(
            bits.join(' · '),
            style: const TextStyle(color: AppColors.textTertiary, fontSize: 11.5),
          ),
      ],
    );
  }
}

class _VoteButton extends StatelessWidget {
  final MediaRequest request;
  final VoidCallback onTap;

  const _VoteButton({required this.request, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final voted = request.iWantIt;
    // TvFocusable so a D-pad/arrow-key reaches the vote on Android TV and Windows, the same way it
    // reaches a poster card.
    return TvFocusable(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Semantics(
        button: true,
        toggled: voted,
        label: voted ? 'Remove your vote from ${request.title}' : 'Me too — also want ${request.title}',
        child: Container(
          width: 56,
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(
            color: voted ? AppColors.accentSoft : AppColors.bgElevated,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: voted ? AppColors.accent : AppColors.dividerStrong),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                voted ? Icons.keyboard_arrow_up : Icons.keyboard_arrow_up_outlined,
                size: 18,
                color: voted ? AppColors.accent : AppColors.textSecondary,
              ),
              Text(
                '${request.wantCount}',
                style: TextStyle(
                  color: voted ? AppColors.accent : AppColors.foreground,
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                ),
              ),
              Text(
                voted ? 'VOTED' : 'ME TOO',
                style: TextStyle(
                  color: voted ? AppColors.accent : AppColors.textTertiary,
                  fontSize: 8.5,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.4,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MineRow extends StatelessWidget {
  final MediaRequest request;
  final VoidCallback? onWatch;
  final VoidCallback? onWithdraw;

  const _MineRow({required this.request, this.onWatch, this.onWithdraw});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.divider)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              RequestPoster.of(request, width: 48),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      request.title,
                      style: const TextStyle(color: AppColors.foreground, fontSize: 14, height: 1.3, fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      wantCountLabel(request.wantCount, youWantIt: request.iWantIt),
                      style: const TextStyle(color: AppColors.textTertiary, fontSize: 11.5),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              RequestStatusPill(request.status),
            ],
          ),
          const SizedBox(height: 14),
          RequestStatusTimeline(request.status),
          if (request.adminNote != null) ...[
            const SizedBox(height: 12),
            _AdminNote(note: request.adminNote!, label: 'Note from the admin'),
          ],
          if (onWatch != null || onWithdraw != null) ...[
            const SizedBox(height: 12),
            Wrap(
              spacing: 10,
              runSpacing: 8,
              children: [
                if (onWatch != null)
                  ElevatedButton.icon(
                    onPressed: onWatch,
                    icon: const Icon(Icons.play_arrow, size: 18),
                    label: const Text('Watch it now'),
                    style: ElevatedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                    ),
                  ),
                if (onWithdraw != null)
                  OutlinedButton(
                    onPressed: onWithdraw,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.danger,
                      side: const BorderSide(color: AppColors.danger),
                    ),
                    child: const Text('Withdraw'),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _AdminNote extends StatelessWidget {
  final String note;
  final String label;

  const _AdminNote({required this.note, this.label = 'Admin'});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(11, 10, 11, 10),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(left: BorderSide(color: AppColors.amber, width: 3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label.toUpperCase(),
            style: const TextStyle(
              color: AppColors.amber,
              fontSize: 10.5,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.8,
            ),
          ),
          const SizedBox(height: 4),
          Text(note, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12, height: 1.5)),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  final String title;
  final String body;
  final String actionLabel;
  final VoidCallback onAction;

  const _EmptyState({
    required this.title,
    required this.body,
    required this.actionLabel,
    required this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    // One of the few things allowed to stay centred (see the full-bleed rule): a short empty state.
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 48, 16, 16),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 320),
          child: Column(
            children: [
              Container(
                width: 56,
                height: 56,
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppColors.dividerStrong),
                ),
                child: const Icon(Icons.auto_awesome, color: AppColors.amber, size: 26),
              ),
              const SizedBox(height: 14),
              Text(
                title,
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.foreground, fontSize: 16, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 6),
              Text(
                body,
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 13, height: 1.5),
              ),
              const SizedBox(height: 16),
              ElevatedButton(onPressed: onAction, child: Text(actionLabel)),
            ],
          ),
        ),
      ),
    );
  }
}
