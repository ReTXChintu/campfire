import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../models/catalog.dart';
import '../../models/media_request.dart';
import '../../services/admin_requests_service.dart';
import '../../services/api_client.dart';
import '../../theme/app_theme.dart';
import '../request_poster.dart';
import '../request_status_pill.dart';

/// The right-hand half of the admin requests split view: everything about one request, and the
/// four things an admin can change about it (status, the type the requester never picked, the note
/// the requester reads, and the catalog item it was fulfilled with).
///
/// The two awkward rules — declined needs a note, added needs a catalog link — are enforced by the
/// backend, which answers with the offending `field`; this panel pins that message under the right
/// control rather than re-deciding the rules locally. Give it a `ValueKey(request.id)` so
/// switching rows starts from the saved values rather than the previous row's edits.
class AdminRequestDetail extends StatefulWidget {
  final AdminMediaRequest request;
  /// Published folders and videos, for the catalog-item picker.
  final List<CatalogListItem> catalogItems;
  final ValueChanged<AdminMediaRequest> onSaved;
  final VoidCallback onDeleted;

  const AdminRequestDetail({
    super.key,
    required this.request,
    required this.catalogItems,
    required this.onSaved,
    required this.onDeleted,
  });

  @override
  State<AdminRequestDetail> createState() => _AdminRequestDetailState();
}

class _AdminRequestDetailState extends State<AdminRequestDetail> {
  late RequestStatus _status;
  late String? _type;
  late CatalogRef? _catalogRef;
  late final TextEditingController _note;

  bool _saving = false;
  String? _statusError;
  String? _noteError;
  String? _catalogError;
  String? _generalError;
  String? _savedMessage;

  @override
  void initState() {
    super.initState();
    _status = widget.request.status;
    _type = widget.request.type;
    _catalogRef = widget.request.catalogRef;
    _note = TextEditingController(text: widget.request.adminNote ?? '');
  }

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _statusError = null;
      _noteError = null;
      _catalogError = null;
      _generalError = null;
      _savedMessage = null;
    });

    final note = _note.text.trim();
    try {
      final updated = await AdminRequestsService.update(
        widget.request.id,
        status: _status,
        adminNote: note.isEmpty ? null : note,
        clearAdminNote: note.isEmpty,
        catalogRef: _catalogRef,
        clearCatalogRef: _catalogRef == null,
        type: _type,
        clearType: _type == null,
      );
      if (!mounted) return;
      setState(() {
        _saving = false;
        _savedMessage = updated.status == RequestStatus.added
            // Worth saying out loud: this is what produces the "Requested by X · Now available"
            // spotlight slide on everyone's home screen.
            ? 'Saved. ${updated.title} now gets a "Now available" spotlight slide for the people who asked.'
            : 'Saved.';
      });
      widget.onSaved(updated);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        switch (error.field) {
          case 'adminNote':
            _noteError = error.message;
            _statusError = 'Declining needs a reason below.';
          case 'catalogRef':
            _catalogError = error.message;
            _statusError = 'Marking this added needs the catalog item below.';
          default:
            _generalError = error.message;
        }
      });
    }
  }

  Future<void> _delete() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: const Text('Delete this request?', style: TextStyle(color: Colors.white)),
        content: Text(
          '${widget.request.title} comes off the board for everyone, votes and all. '
          'Declining it with a reason is usually kinder.',
          style: const TextStyle(color: AppColors.textSecondary),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            style: TextButton.styleFrom(foregroundColor: AppColors.danger),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await AdminRequestsService.remove(widget.request.id);
      if (!mounted) return;
      widget.onDeleted();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _generalError = error.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final request = widget.request;

    return Container(
      decoration: BoxDecoration(
        color: AppColors.bgElevated,
        border: Border.all(color: AppColors.divider),
        borderRadius: BorderRadius.circular(16),
      ),
      child: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(request.title, style: AppTheme.display(fontSize: 28)),
                    const SizedBox(height: 4),
                    Text(
                      _subtitleFor(request),
                      style: const TextStyle(color: AppColors.textTertiary, fontSize: 12),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              RequestStatusPill(request.status),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              RequestPoster.ofAdmin(request, width: 104),
              const SizedBox(width: 14),
              Expanded(child: _reference(request)),
            ],
          ),
          const SizedBox(height: 16),
          _whoWantsIt(request),
          const SizedBox(height: 16),
          _adminActions(),
        ],
      ),
    );
  }

  String _subtitleFor(AdminMediaRequest request) {
    final bits = <String>[
      if (request.year != null) '${request.year}',
      if (request.type != null) request.type == 'series' ? 'Series' : 'Movie',
      if (request.requestedBy != null) 'asked by ${request.requestedBy!.display}',
      if (request.createdAt != null) _ago(request.createdAt!),
    ];
    return bits.isEmpty ? request.id : bits.join(' · ');
  }

  Widget _reference(AdminMediaRequest request) {
    final link = request.refLink;
    final meta = request.refMeta;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (link != null && link.isNotEmpty) ...[
          const Text('Reference link', style: TextStyle(color: AppColors.textTertiary, fontSize: 11.5)),
          const SizedBox(height: 3),
          InkWell(
            onTap: () => launchUrl(Uri.parse(link), mode: LaunchMode.externalApplication),
            child: Text(
              link,
              style: const TextStyle(color: AppColors.accent, fontSize: 12, decoration: TextDecoration.underline),
            ),
          ),
        ] else
          Container(
            padding: const EdgeInsets.all(9),
            decoration: BoxDecoration(
              color: AppColors.amber.withValues(alpha: 0.1),
              border: Border.all(color: AppColors.amber.withValues(alpha: 0.5)),
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Text(
              'No link — only a reference image. Check the year before sourcing.',
              style: TextStyle(color: AppColors.foreground, fontSize: 12, height: 1.4),
            ),
          ),
        const SizedBox(height: 10),
        if (meta != null) ...[
          Text(
            meta.title,
            style: const TextStyle(color: AppColors.foreground, fontSize: 13, fontWeight: FontWeight.w700),
          ),
          if (meta.overview != null && meta.overview!.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              meta.overview!,
              maxLines: 4,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 12, height: 1.45),
            ),
          ],
        ] else
          const Text(
            'No metadata fetched — nothing to verify against.',
            style: TextStyle(color: AppColors.textTertiary, fontSize: 12),
          ),
      ],
    );
  }

  Widget _whoWantsIt(AdminMediaRequest request) {
    final voters = request.voters;
    return _Group(
      label: 'Who wants it',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${request.wantCount} ${request.wantCount == 1 ? "vote" : "votes"}'
            '${request.requestedBy != null ? " · ${request.requestedBy!.display} asked" : ""}',
            style: const TextStyle(color: AppColors.foreground, fontSize: 12.5),
          ),
          if (voters.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              voters.map((v) => v.display).join(', ') +
                  (request.wantCount > voters.length ? ' +${request.wantCount - voters.length} more' : ''),
              style: const TextStyle(color: AppColors.textTertiary, fontSize: 11.5, height: 1.45),
            ),
          ],
        ],
      ),
    );
  }

  Widget _adminActions() {
    return _Group(
      label: 'Admin action',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_generalError != null) ...[
            _Error(_generalError!),
            const SizedBox(height: 12),
          ],
          if (_savedMessage != null) ...[
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: AppColors.live.withValues(alpha: 0.12),
                border: Border.all(color: AppColors.live.withValues(alpha: 0.5)),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                _savedMessage!,
                style: const TextStyle(color: AppColors.foreground, fontSize: 12, height: 1.45),
              ),
            ),
            const SizedBox(height: 12),
          ],
          const Text('Status', style: _labelStyle),
          const SizedBox(height: 6),
          DropdownButtonFormField<RequestStatus>(
            initialValue: _status,
            dropdownColor: AppColors.surface,
            decoration: InputDecoration(errorText: _statusError),
            items: [
              for (final status in RequestStatus.values)
                DropdownMenuItem(value: status, child: Text(status.label)),
            ],
            onChanged: (value) => setState(() => _status = value ?? _status),
          ),
          const SizedBox(height: 4),
          const Text(
            'New → Planned → Sourcing → Added. Declined needs a reason; Added needs the catalog item.',
            style: TextStyle(color: AppColors.textTertiary, fontSize: 11.5, height: 1.4),
          ),
          const SizedBox(height: 14),
          const Text('Type', style: _labelStyle),
          const SizedBox(height: 6),
          DropdownButtonFormField<String?>(
            initialValue: _type,
            dropdownColor: AppColors.surface,
            items: const [
              DropdownMenuItem(value: null, child: Text('Not set')),
              DropdownMenuItem(value: 'movie', child: Text('Movie')),
              DropdownMenuItem(value: 'series', child: Text('Series')),
            ],
            onChanged: (value) => setState(() => _type = value),
          ),
          const SizedBox(height: 4),
          const Text(
            "The requester never picks this — set it if the link lookup couldn't.",
            style: TextStyle(color: AppColors.textTertiary, fontSize: 11.5, height: 1.4),
          ),
          const SizedBox(height: 14),
          const Text('Note to the requester', style: _labelStyle),
          const SizedBox(height: 6),
          TextField(
            controller: _note,
            minLines: 2,
            maxLines: 5,
            decoration: InputDecoration(
              hintText: 'What you found, or why not…',
              hintStyle: const TextStyle(color: AppColors.textTertiary),
              errorText: _noteError,
            ),
          ),
          const SizedBox(height: 14),
          const Text('Link to catalog item', style: _labelStyle),
          const SizedBox(height: 6),
          DropdownButtonFormField<CatalogRef?>(
            initialValue: _catalogRefValue(),
            isExpanded: true,
            dropdownColor: AppColors.surface,
            decoration: InputDecoration(errorText: _catalogError),
            items: [
              const DropdownMenuItem(value: null, child: Text('— not in the library yet —')),
              for (final item in widget.catalogItems)
                DropdownMenuItem(
                  value: CatalogRef(
                    kind: item is CatalogFolderItem ? 'folder' : 'video',
                    id: item.id,
                  ),
                  child: Text(
                    '${item.name}${item is CatalogFolderItem ? " (series)" : ""}',
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
            ],
            onChanged: (value) => setState(() => _catalogRef = value),
          ),
          if (widget.request.catalogTitle != null) ...[
            const SizedBox(height: 4),
            Text(
              'Currently ${widget.request.catalogTitle}',
              style: const TextStyle(color: AppColors.live, fontSize: 11.5),
            ),
          ],
          const SizedBox(height: 18),
          Row(
            children: [
              ElevatedButton(
                onPressed: _saving ? null : _save,
                child: _saving
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.onAccent),
                      )
                    : const Text('Save'),
              ),
              const Spacer(),
              OutlinedButton(
                onPressed: _saving ? null : _delete,
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.danger,
                  side: const BorderSide(color: AppColors.danger),
                ),
                child: const Text('Delete'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  /// The dropdown compares by value, so the current ref has to be the *same* [CatalogRef] instance
  /// the item list offers (equality is by kind+id, which is why CatalogRef overrides ==).
  CatalogRef? _catalogRefValue() {
    final current = _catalogRef;
    if (current == null) return null;
    for (final item in widget.catalogItems) {
      final ref = CatalogRef(kind: item is CatalogFolderItem ? 'folder' : 'video', id: item.id);
      if (ref == current) return ref;
    }
    // Points at something the picker doesn't list (unpublished, or deleted since) — don't silently
    // show "not in the library yet", keep the dropdown unset and leave the note above to explain.
    return null;
  }

  static const _labelStyle = TextStyle(
    color: AppColors.textSecondary,
    fontSize: 12.5,
    fontWeight: FontWeight.w600,
  );
}

class _Group extends StatelessWidget {
  final String label;
  final Widget child;

  const _Group({required this.label, required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.dividerStrong),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(color: AppColors.foreground, fontSize: 13, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 10),
          child,
        ],
      ),
    );
  }
}

class _Error extends StatelessWidget {
  final String message;
  const _Error(this.message);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.dangerSoft,
        border: Border.all(color: AppColors.danger.withValues(alpha: 0.5)),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        message,
        style: const TextStyle(color: AppColors.foreground, fontSize: 12, height: 1.45),
      ),
    );
  }
}

/// "3 days ago" / "today" — enough precision for a queue, without pulling in a date library.
String _ago(DateTime when) {
  final days = DateTime.now().difference(when).inDays;
  if (days <= 0) return 'today';
  if (days == 1) return 'yesterday';
  if (days < 30) return '$days days ago';
  final months = (days / 30).floor();
  return '$months ${months == 1 ? "month" : "months"} ago';
}
