import 'dart:async';
import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:media_kit/media_kit.dart';
import 'package:media_kit_video/media_kit_video.dart';

import '../../config.dart';
import '../../models/admin_catalog.dart';
import '../../services/admin_catalog_service.dart';
import '../../services/api_client.dart';
import '../../services/media_token_service.dart';
import '../../theme/app_theme.dart';

String _pad2(int n) => n.toString().padLeft(2, '0');

String _formatTime(double seconds) {
  final total = seconds < 0 ? 0 : seconds.floor();
  final h = total ~/ 3600;
  final m = (total % 3600) ~/ 60;
  final s = total % 60;
  return h > 0 ? '$h:${_pad2(m)}:${_pad2(s)}' : '${_pad2(m)}:${_pad2(s)}';
}

String _trackSummary(List<SubtitleTrackInfo> tracks) {
  return tracks.map((t) => t.language ?? t.title ?? 'Track ${t.index}').join(', ');
}

/// Mirrors apps/frontend/src/components/admin/VideoCurationForm.tsx — same two-column layout
/// (preview + capture-time buttons on the left, fields/subtitles/save/publish on the right) and
/// the same five admin endpoints, just re-hosted in Flutter for the desktop admin panel.
class AdminVideoCurationForm extends StatefulWidget {
  final String fileId;
  final String driveName;
  final bool isMkv;
  final String? initialTitle;
  final double? initialIntroStart;
  final double? initialIntroEnd;
  final double? initialOutroStart;
  final List<String> initialSubtitleSetIds;
  final List<SubtitleSetOption> subtitleSetOptions;
  final String status;
  final VoidCallback onChanged;

  const AdminVideoCurationForm({
    super.key,
    required this.fileId,
    required this.driveName,
    required this.isMkv,
    required this.initialTitle,
    required this.initialIntroStart,
    required this.initialIntroEnd,
    required this.initialOutroStart,
    required this.initialSubtitleSetIds,
    required this.subtitleSetOptions,
    required this.status,
    required this.onChanged,
  });

  @override
  State<AdminVideoCurationForm> createState() => _AdminVideoCurationFormState();
}

class _AdminVideoCurationFormState extends State<AdminVideoCurationForm> {
  late final Player _player = Player();
  late final VideoController _videoController = VideoController(_player);
  final List<StreamSubscription> _subs = [];
  double _currentTime = 0;

  late final TextEditingController _titleController =
      TextEditingController(text: widget.initialTitle ?? widget.driveName);
  late final TextEditingController _introStartController =
      TextEditingController(text: widget.initialIntroStart?.toStringAsFixed(0) ?? '');
  late final TextEditingController _introEndController =
      TextEditingController(text: widget.initialIntroEnd?.toStringAsFixed(0) ?? '');
  late final TextEditingController _outroStartController =
      TextEditingController(text: widget.initialOutroStart?.toStringAsFixed(0) ?? '');
  final TextEditingController _uploadLabelController = TextEditingController();

  late List<String> _subtitleSetIds = List.of(widget.initialSubtitleSetIds);
  PlatformFile? _pickedFile;
  String? _pickedFileText;

  bool _saving = false;
  bool _publishing = false;
  bool _uploading = false;
  bool _saved = false;
  String? _error;
  String? _previewError;

  @override
  void initState() {
    super.initState();
    _subs.add(_player.stream.position.listen((p) {
      if (mounted) setState(() => _currentTime = p.inMilliseconds / 1000);
    }));
    // Without this, a broken preview (e.g. the ffmpeg remux failing for a non-native, non-MKV
    // format) just leaves a black box with no explanation — see media_kit_video_player.dart's
    // equivalent listener, added after exactly this kind of failure was otherwise invisible.
    _subs.add(_player.stream.error.listen((message) {
      if (mounted) setState(() => _previewError = message);
    }));
    _bootstrapPreview();
  }

  Future<void> _bootstrapPreview() async {
    try {
      final token = await MediaTokenService.mint(widget.fileId);
      if (!mounted) return;
      final uri = Uri.parse('$apiBaseUrl/api/stream/${widget.fileId}').replace(
        // This preview is played with media_kit (libmpv), which — unlike the web admin's plain
        // <video> tag — can decode raw MKV directly, so it opts into the raw byte passthrough
        // (see routes/stream.ts) instead of the ffmpeg remux, same as MediaKitVideoPlayer.
        queryParameters: {'token': token, if (widget.isMkv) 'raw': '1'},
      );
      await _player.open(Media(uri.toString()), play: false);
    } catch (_) {
      // No preview — the rest of the form (title/intro/outro/subtitles) still works, capture
      // buttons just have nothing to capture from.
    }
  }

  @override
  void dispose() {
    for (final sub in _subs) {
      sub.cancel();
    }
    _titleController.dispose();
    _introStartController.dispose();
    _introEndController.dispose();
    _outroStartController.dispose();
    _uploadLabelController.dispose();
    _player.dispose();
    super.dispose();
  }

  double? _parseField(TextEditingController controller) {
    final text = controller.text.trim();
    if (text.isEmpty) return null;
    return double.tryParse(text);
  }

  void _toggleSubtitleSet(String id) {
    setState(() {
      if (_subtitleSetIds.contains(id)) {
        _subtitleSetIds.remove(id);
      } else {
        _subtitleSetIds.add(id);
      }
    });
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _saved = false;
      _error = null;
    });
    try {
      await AdminCatalogService.saveVideo(
        widget.fileId,
        title: _titleController.text.trim(),
        subtitleSetIds: _subtitleSetIds,
        introStart: _parseField(_introStartController),
        introEnd: _parseField(_introEndController),
        outroStart: _parseField(_outroStartController),
      );
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
      await AdminCatalogService.toggleVideoPublish(widget.fileId, publish: widget.status != 'published');
      if (!mounted) return;
      widget.onChanged();
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e is ApiException ? e.message : 'Failed — please try again.');
    } finally {
      if (mounted) setState(() => _publishing = false);
    }
  }

  Future<void> _pickSubtitleFile() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['srt', 'vtt'],
      withData: true,
    );
    final file = result?.files.single;
    final bytes = file?.bytes;
    if (file == null || bytes == null) return;
    setState(() {
      _pickedFile = file;
      _pickedFileText = utf8.decode(bytes);
    });
  }

  Future<void> _uploadSubtitle() async {
    final file = _pickedFile;
    final text = _pickedFileText;
    final label = _uploadLabelController.text.trim();
    if (file == null || text == null || label.isEmpty) return;

    setState(() {
      _uploading = true;
      _error = null;
    });
    try {
      final format = file.name.toLowerCase().endsWith('.vtt') ? 'vtt' : 'srt';
      final subtitleSetId = await AdminCatalogService.uploadSubtitle(
        widget.fileId,
        label: label,
        format: format,
        text: text,
      );
      if (!mounted) return;
      setState(() {
        _subtitleSetIds = [..._subtitleSetIds, subtitleSetId];
        _uploadLabelController.clear();
        _pickedFile = null;
        _pickedFileText = null;
      });
      widget.onChanged();
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e is ApiException ? e.message : 'Upload failed — please try again.');
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isWide = MediaQuery.sizeOf(context).width >= 900;
    final left = _previewColumn();
    final right = _fieldsColumn();

    return isWide
        ? IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(child: left),
                const SizedBox(width: 32),
                Expanded(child: right),
              ],
            ),
          )
        : Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [left, const SizedBox(height: 32), right],
          );
  }

  Widget _previewColumn() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: AspectRatio(
            aspectRatio: 16 / 9,
            child: ColoredBox(
              color: Colors.black,
              child: Video(controller: _videoController),
            ),
          ),
        ),
        const SizedBox(height: 8),
        Text(
          'Scrub to the right moment, then use the buttons on the right to capture the current time '
          '(currently ${_formatTime(_currentTime)}).',
          style: const TextStyle(color: AppColors.textTertiary, fontSize: 12),
        ),
        if (_previewError != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              'Preview failed: $_previewError',
              style: const TextStyle(color: Color(0xFFF87171), fontSize: 12),
            ),
          ),
      ],
    );
  }

  Widget _fieldsColumn() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Drive name: ${widget.driveName}', style: const TextStyle(color: AppColors.textTertiary, fontSize: 12)),
        const SizedBox(height: 8),
        const Text('Title', style: TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w500)),
        const SizedBox(height: 6),
        TextField(controller: _titleController, onChanged: (_) => setState(() => _saved = false)),
        const SizedBox(height: 20),

        const Text('Skip Intro window', style: TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w500)),
        const SizedBox(height: 6),
        _timeCaptureRow('Start (s)', _introStartController),
        const SizedBox(height: 8),
        _timeCaptureRow('End (s)', _introEndController),
        const SizedBox(height: 20),

        const Text('Next Episode prompt start', style: TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w500)),
        const SizedBox(height: 6),
        _timeCaptureRow('Start (s)', _outroStartController),
        const SizedBox(height: 20),

        const Text('Subtitles', style: TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w500)),
        const SizedBox(height: 8),
        if (widget.subtitleSetOptions.isEmpty)
          const Text(
            'None yet — upload a file below, or convert a video with subtitles in the Converter tab.',
            style: TextStyle(color: AppColors.textTertiary, fontSize: 13),
          )
        else
          ...widget.subtitleSetOptions.map(
            (set) => CheckboxListTile(
              value: _subtitleSetIds.contains(set.id),
              onChanged: (_) => _toggleSubtitleSet(set.id),
              controlAffinity: ListTileControlAffinity.leading,
              contentPadding: EdgeInsets.zero,
              title: Text(set.sourceLabel, style: const TextStyle(color: AppColors.foreground, fontSize: 14)),
              subtitle: Text(_trackSummary(set.tracks), style: const TextStyle(color: AppColors.textTertiary, fontSize: 12)),
            ),
          ),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            border: Border.all(color: AppColors.divider, style: BorderStyle.solid),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Upload a subtitle file', style: TextStyle(color: AppColors.foreground, fontSize: 12, fontWeight: FontWeight.w500)),
              const SizedBox(height: 8),
              OutlinedButton(
                onPressed: _pickSubtitleFile,
                child: Text(_pickedFile?.name ?? 'Choose .srt or .vtt file'),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _uploadLabelController,
                      decoration: const InputDecoration(hintText: 'Label, e.g. English'),
                      onChanged: (_) => setState(() {}),
                    ),
                  ),
                  const SizedBox(width: 8),
                  ElevatedButton(
                    onPressed: _uploading || _pickedFile == null || _uploadLabelController.text.trim().isEmpty
                        ? null
                        : _uploadSubtitle,
                    child: Text(_uploading ? 'Uploading…' : 'Upload'),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),

        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text(_error!, style: const TextStyle(color: Color(0xFFF87171), fontSize: 13)),
          ),

        ElevatedButton(
          onPressed: _saving || _titleController.text.trim().isEmpty ? null : _save,
          child: Text(_saving ? 'Saving…' : 'Save'),
        ),
        if (_saved) const Padding(padding: EdgeInsets.only(top: 8), child: Text('Saved.', style: TextStyle(color: AppColors.live))),

        const Padding(padding: EdgeInsets.symmetric(vertical: 16), child: Divider(height: 1)),
        Row(
          children: [
            const Text('Status: ', style: TextStyle(color: AppColors.textSecondary)),
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
      ],
    );
  }

  Widget _timeCaptureRow(String placeholder, TextEditingController controller) {
    return Row(
      children: [
        SizedBox(
          width: 110,
          child: TextField(
            controller: controller,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(hintText: placeholder),
          ),
        ),
        const SizedBox(width: 8),
        OutlinedButton(
          onPressed: () => setState(() => controller.text = _currentTime.round().toString()),
          child: const Text('Set from preview', style: TextStyle(fontSize: 12)),
        ),
      ],
    );
  }
}
