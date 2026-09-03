import 'package:flutter/material.dart';
import '../../services/admin_catalog_service.dart';
import '../../services/api_client.dart';
import '../../theme/app_theme.dart';

/// Mirrors apps/frontend/src/components/admin/FolderTitleForm.tsx.
class AdminFolderTitleForm extends StatefulWidget {
  final String folderId;
  final String? initialTitle;
  final String driveName;
  final String status;
  final VoidCallback onChanged;

  const AdminFolderTitleForm({
    super.key,
    required this.folderId,
    required this.initialTitle,
    required this.driveName,
    required this.status,
    required this.onChanged,
  });

  @override
  State<AdminFolderTitleForm> createState() => _AdminFolderTitleFormState();
}

class _AdminFolderTitleFormState extends State<AdminFolderTitleForm> {
  late final TextEditingController _titleController =
      TextEditingController(text: widget.initialTitle ?? widget.driveName);
  bool _saving = false;
  bool _publishing = false;
  bool _saved = false;
  String? _error;

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _saved = false;
      _error = null;
    });
    try {
      await AdminCatalogService.saveFolderTitle(widget.folderId, _titleController.text.trim());
      if (!mounted) return;
      setState(() => _saved = true);
      widget.onChanged();
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e is ApiException ? e.message : 'Save failed — please try again.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _togglePublish() async {
    setState(() {
      _publishing = true;
      _error = null;
    });
    try {
      await AdminCatalogService.toggleFolderPublish(widget.folderId, publish: widget.status != 'published');
      if (!mounted) return;
      widget.onChanged();
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e is ApiException ? e.message : 'Failed — please try again.');
    } finally {
      if (mounted) setState(() => _publishing = false);
    }
  }

  @override
  void dispose() {
    _titleController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(border: Border.all(color: AppColors.divider), borderRadius: BorderRadius.circular(8)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Drive name: ${widget.driveName}', style: const TextStyle(color: AppColors.textTertiary, fontSize: 12)),
          const SizedBox(height: 8),
          const Text('Title', style: TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w500)),
          const SizedBox(height: 6),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _titleController,
                  onChanged: (_) => setState(() => _saved = false),
                ),
              ),
              const SizedBox(width: 8),
              ElevatedButton(
                onPressed: _saving || _titleController.text.trim().isEmpty ? null : _save,
                child: Text(_saving ? 'Saving…' : 'Save'),
              ),
            ],
          ),
          if (_saved) const Padding(padding: EdgeInsets.only(top: 8), child: Text('Saved.', style: TextStyle(color: AppColors.live))),
          const Padding(padding: EdgeInsets.symmetric(vertical: 16), child: Divider(height: 1)),
          Row(
            children: [
              Text('Status: ', style: const TextStyle(color: AppColors.textSecondary)),
              Text(
                widget.status == 'published'
                    ? 'Published'
                    : widget.status == 'curated'
                        ? 'Curated, not published'
                        : 'Pending',
                style: TextStyle(color: widget.status == 'published' ? AppColors.live : AppColors.foreground),
              ),
              const Spacer(),
              if (widget.status != 'pending')
                ElevatedButton(
                  onPressed: _publishing ? null : _togglePublish,
                  style: widget.status == 'published'
                      ? ElevatedButton.styleFrom(backgroundColor: Colors.transparent, foregroundColor: AppColors.foreground)
                      : ElevatedButton.styleFrom(backgroundColor: AppColors.live, foregroundColor: Colors.black),
                  child: Text(_publishing ? 'Working…' : (widget.status == 'published' ? 'Unpublish' : 'Publish')),
                ),
            ],
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(_error!, style: const TextStyle(color: Color(0xFFF87171), fontSize: 13)),
            ),
        ],
      ),
    );
  }
}
