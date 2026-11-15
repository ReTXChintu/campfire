import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../models/admin_catalog.dart';
import '../../services/admin_catalog_service.dart';
import '../../services/api_client.dart';
import '../../theme/app_theme.dart';
import '../authed_network_image.dart';

/// Mirrors apps/frontend/src/components/admin/ArtworkPanel.tsx: a top-level movie's or series'
/// TMDb match, the image viewers see, and the three ways to change it — paste an IMDb/TMDb link,
/// search automatically, or remove.
class AdminArtworkPanel extends StatefulWidget {
  final String kind; // "folder" | "video"
  final String id;
  final CatalogArtwork? artwork;
  final bool autoOff;

  /// A folder with its own thumbnail.* image in Drive.
  final bool hasDriveThumbnail;
  final VoidCallback onChanged;

  const AdminArtworkPanel({
    super.key,
    required this.kind,
    required this.id,
    required this.artwork,
    required this.autoOff,
    required this.hasDriveThumbnail,
    required this.onChanged,
  });

  @override
  State<AdminArtworkPanel> createState() => _AdminArtworkPanelState();
}

class _AdminArtworkPanelState extends State<AdminArtworkPanel> {
  final _link = TextEditingController();
  String? _busy; // which action is running
  String? _error;
  String? _notice;

  String get _imagePath =>
      '${widget.kind == 'folder' ? '/api/thumbnail-folder' : '/api/thumbnail'}/${widget.id}';

  Future<void> _run(String action, Future<void> Function() call, String done) async {
    setState(() {
      _busy = action;
      _error = null;
      _notice = null;
    });
    try {
      await call();
      if (!mounted) return;
      // Cards and the series header load the plain path; drop it so they show the new image.
      evictAuthedImage(_imagePath);
      if (action == 'link') _link.clear();
      setState(() => _notice = done);
      widget.onChanged();
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e is ApiException ? e.message : 'Failed — please try again.');
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  void _useLink() {
    final link = _link.text.trim();
    if (link.isEmpty) return;
    _run('link', () => AdminCatalogService.setArtworkLink(widget.kind, widget.id, link),
        'Artwork updated from the link.');
  }

  @override
  void dispose() {
    _link.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final artwork = widget.artwork;
    // The version makes the preview refetch after a change; the server ignores it.
    final version = Uri.encodeQueryComponent(artwork?.matchedAt ?? (widget.autoOff ? 'off' : 'none'));
    final driveWins = widget.kind == 'folder' && widget.hasDriveThumbnail && artwork?.source != 'link';
    const secondary = TextStyle(color: AppColors.textSecondary, fontSize: 13, height: 1.4);
    const tertiary = TextStyle(color: AppColors.textTertiary, fontSize: 12, height: 1.4);

    final preview = ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: AspectRatio(
        aspectRatio: 16 / 9,
        child: AuthedNetworkImage(key: ValueKey(version), path: '$_imagePath?v=$version'),
      ),
    );

    final details = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (artwork != null)
          Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              const Text('Matched to ', style: secondary),
              InkWell(
                onTap: () => launchUrl(Uri.parse(artwork.tmdbUrl), mode: LaunchMode.externalApplication),
                child: Text(
                  '${artwork.title}${artwork.year != null ? ' (${artwork.year})' : ''}',
                  style: secondary.copyWith(color: AppColors.foreground, decoration: TextDecoration.underline),
                ),
              ),
              Text(
                ' on TMDb · ${artwork.source == 'link' ? 'from a pasted link' : 'found automatically'}',
                style: secondary,
              ),
            ],
          )
        else
          Text(
            widget.autoOff
                ? "Artwork removed. It won't be matched automatically again."
                : 'Not matched yet. Paste the title\'s IMDb or TMDb link, or search for it.',
            style: secondary,
          ),
        if (driveWins) ...[
          const SizedBox(height: 4),
          const Text(
            "This folder's own thumbnail image in Drive is shown instead. Paste a link to use TMDb's artwork.",
            style: tertiary,
          ),
        ],
        if (artwork?.overview != null) ...[
          const SizedBox(height: 8),
          Text(artwork!.overview!, maxLines: 3, overflow: TextOverflow.ellipsis, style: tertiary),
        ],
        const SizedBox(height: 14),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _link,
                keyboardType: TextInputType.url,
                onSubmitted: (_) => _useLink(),
                decoration: const InputDecoration(
                  labelText: 'IMDb or TMDb link',
                  hintText: 'https://www.imdb.com/title/tt…',
                  isDense: true,
                ),
              ),
            ),
            const SizedBox(width: 8),
            ListenableBuilder(
              listenable: _link,
              builder: (context, _) => ElevatedButton(
                onPressed: _busy != null || _link.text.trim().isEmpty ? null : _useLink,
                child: Text(_busy == 'link' ? 'Saving…' : 'Use link'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            OutlinedButton(
              onPressed: _busy != null
                  ? null
                  : () => _run('auto', () => AdminCatalogService.matchArtwork(widget.kind, widget.id),
                      'Matched automatically.'),
              child: Text(_busy == 'auto' ? 'Searching…' : 'Find automatically'),
            ),
            if (artwork != null)
              OutlinedButton(
                onPressed: _busy != null
                    ? null
                    : () => _run('remove', () => AdminCatalogService.clearArtwork(widget.kind, widget.id),
                        'Artwork removed.'),
                child: Text(_busy == 'remove' ? 'Removing…' : 'Remove'),
              ),
          ],
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(_error!, style: const TextStyle(color: Color(0xFFF87171), fontSize: 13)),
          )
        else if (_notice != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(_notice!, style: const TextStyle(color: AppColors.live, fontSize: 13)),
          ),
      ],
    );

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.divider),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Artwork',
              style: TextStyle(color: AppColors.foreground, fontSize: 14, fontWeight: FontWeight.w600)),
          const SizedBox(height: 12),
          LayoutBuilder(
            builder: (context, constraints) {
              if (constraints.maxWidth < 640) {
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [preview, const SizedBox(height: 14), details],
                );
              }
              return Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(width: 320, child: preview),
                  const SizedBox(width: 20),
                  Expanded(child: details),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

/// Mirrors apps/frontend/src/components/admin/MatchArtworkButton.tsx.
class AdminMatchArtworkButton extends StatefulWidget {
  final VoidCallback onMatched;
  const AdminMatchArtworkButton({super.key, required this.onMatched});

  @override
  State<AdminMatchArtworkButton> createState() => _AdminMatchArtworkButtonState();
}

class _AdminMatchArtworkButtonState extends State<AdminMatchArtworkButton> {
  bool _loading = false;
  ArtworkAutoMatchResult? _result;
  String? _error;

  Future<void> _run() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await AdminCatalogService.matchMissingArtwork();
      if (!mounted) return;
      setState(() => _result = result);
      widget.onMatched();
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e is ApiException ? e.message : 'Matching failed — please try again.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final result = _result;
    const style = TextStyle(color: AppColors.textSecondary, fontSize: 13);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        OutlinedButton(
          onPressed: _loading ? null : _run,
          child: Text(_loading ? 'Matching artwork…' : 'Match missing artwork'),
        ),
        if (result != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              [
                result.matched > 0
                    ? 'Matched ${result.matched} title${result.matched == 1 ? '' : 's'}.'
                    : 'Nothing new matched.',
                if (result.unmatched.isEmpty) 'Every movie and series has artwork.',
                if (result.unmatched.isNotEmpty)
                  'Still need a link: ${result.unmatched.map((u) => u.name).join(', ')}',
              ].join(' '),
              style: style,
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
