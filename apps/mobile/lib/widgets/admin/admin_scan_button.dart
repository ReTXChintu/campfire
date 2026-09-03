import 'package:flutter/material.dart';
import '../../models/admin_catalog.dart';
import '../../services/admin_catalog_service.dart';
import '../../services/api_client.dart';
import '../../theme/app_theme.dart';

/// Mirrors apps/frontend/src/components/admin/ScanButton.tsx — walks Drive for new/removed
/// folders and videos. [onScanned] lets the parent page refetch its own data afterward (this app
/// has no shared query cache to invalidate automatically, unlike the web app's react-query setup).
class AdminScanButton extends StatefulWidget {
  final VoidCallback onScanned;

  const AdminScanButton({super.key, required this.onScanned});

  @override
  State<AdminScanButton> createState() => _AdminScanButtonState();
}

class _AdminScanButtonState extends State<AdminScanButton> {
  bool _loading = false;
  ScanResult? _result;
  String? _error;

  Future<void> _run() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await AdminCatalogService.runScan();
      if (!mounted) return;
      setState(() => _result = result);
      widget.onScanned();
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e is ApiException ? e.message : 'Scan failed — please try again.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final result = _result;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ElevatedButton(
          onPressed: _loading ? null : _run,
          child: Text(_loading ? 'Scanning Drive…' : 'Scan Drive'),
        ),
        if (result != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              'Scanned ${result.foldersScanned} folders / ${result.videosScanned} videos — '
              'found ${result.foldersAdded} new folders and ${result.videosAdded} new videos.'
              '${result.erroredFolderIds.isNotEmpty ? ' (${result.erroredFolderIds.length} folders failed to scan)' : ''}',
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 13),
            ),
          ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(_error!, style: const TextStyle(color: Color(0xFFF87171), fontSize: 13)),
          ),
      ],
    );
  }
}
