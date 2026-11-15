import 'package:flutter/material.dart';
import '../../models/admin_catalog.dart';
import '../../services/admin_catalog_service.dart';
import '../../services/api_client.dart';
import '../../theme/app_theme.dart';

const _secondary = TextStyle(color: AppColors.textSecondary, fontSize: 13, height: 1.4);
const _tertiary = TextStyle(color: AppColors.textTertiary, fontSize: 12, height: 1.4);

Widget _panel({required String heading, required List<Widget> children}) => Container(
  width: double.infinity,
  margin: const EdgeInsets.only(bottom: 20),
  padding: const EdgeInsets.all(16),
  decoration: BoxDecoration(
    border: Border.all(color: AppColors.divider),
    borderRadius: BorderRadius.circular(8),
  ),
  child: Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        heading,
        style: const TextStyle(color: AppColors.foreground, fontSize: 14, fontWeight: FontWeight.w600),
      ),
      const SizedBox(height: 12),
      ...children,
    ],
  ),
);

/// Mirrors apps/frontend/src/components/admin/EpisodeNamingPanel.tsx: name a matched series'
/// episodes from TMDb, or turn that off. Shown on a series' own admin page, under its artwork.
class AdminEpisodeNamingPanel extends StatefulWidget {
  final String folderId;
  final bool namingOff;
  final VoidCallback onChanged;

  const AdminEpisodeNamingPanel({
    super.key,
    required this.folderId,
    required this.namingOff,
    required this.onChanged,
  });

  @override
  State<AdminEpisodeNamingPanel> createState() => _AdminEpisodeNamingPanelState();
}

class _AdminEpisodeNamingPanelState extends State<AdminEpisodeNamingPanel> {
  String? _busy;
  String? _error;
  EpisodeMatchResult? _result;

  bool get _enabled => !widget.namingOff;

  Future<void> _run(String action, Future<void> Function() call) async {
    setState(() {
      _busy = action;
      _error = null;
    });
    try {
      await call();
      if (!mounted) return;
      widget.onChanged();
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e is ApiException ? e.message : 'Failed — please try again.');
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final result = _result;
    return _panel(
      heading: 'Episode names',
      children: [
        Text(
          _enabled
              ? 'Episodes under this series take their name, synopsis and still from TMDb, matched by position within their season.'
              : 'Turned off. Episodes keep whatever names they already have.',
          style: _secondary,
        ),
        const SizedBox(height: 4),
        const Text(
          'An episode whose title you typed yourself is never renamed, unless you use the second button.',
          style: _tertiary,
        ),
        const SizedBox(height: 14),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            OutlinedButton(
              onPressed: _busy != null || !_enabled
                  ? null
                  : () => _run('match', () async {
                      final result = await AdminCatalogService.matchEpisodes(widget.folderId);
                      if (mounted) setState(() => _result = result);
                    }),
              child: Text(_busy == 'match' ? 'Naming…' : 'Name episodes now'),
            ),
            OutlinedButton(
              onPressed: _busy != null || !_enabled
                  ? null
                  : () => _run('force', () async {
                      final result = await AdminCatalogService.matchEpisodes(
                        widget.folderId,
                        force: true,
                      );
                      if (mounted) setState(() => _result = result);
                    }),
              child: Text(_busy == 'force' ? 'Renaming…' : "Use TMDb's names for every episode"),
            ),
            OutlinedButton(
              onPressed: _busy != null
                  ? null
                  : () => _run(
                      'toggle',
                      () => AdminCatalogService.setEpisodeNaming(widget.folderId, enabled: !_enabled),
                    ),
              child: Text(_enabled ? 'Turn off' : 'Turn back on'),
            ),
          ],
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(_error!, style: const TextStyle(color: Color(0xFFF87171), fontSize: 13)),
          )
        else if (result != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              result.matched == 0
                  ? 'No episodes to name — check the season numbers below.'
                  : 'Matched ${result.matched} episode${result.matched == 1 ? '' : 's'}, renaming ${result.renamed}.',
              style: const TextStyle(color: AppColors.live, fontSize: 13),
            ),
          ),
        if (result != null && result.unresolved.isNotEmpty) ...[
          const SizedBox(height: 14),
          const Divider(color: AppColors.divider, height: 1),
          const SizedBox(height: 14),
          const Text(
            "These folders hold episodes but don't say which season — open one and set the number.",
            style: _secondary,
          ),
          const SizedBox(height: 8),
          for (final folder in result.unresolved)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text('· ${folder.name}', style: _tertiary),
            ),
        ],
      ],
    );
  }
}

/// Mirrors the season control on the web's admin folder page: which season of its series this
/// folder holds. Saving re-matches the whole series straight away.
class AdminSeasonPanel extends StatefulWidget {
  final String folderId;
  final String folderName;
  final EpisodeSeries series;
  final VoidCallback onChanged;

  const AdminSeasonPanel({
    super.key,
    required this.folderId,
    required this.folderName,
    required this.series,
    required this.onChanged,
  });

  @override
  State<AdminSeasonPanel> createState() => _AdminSeasonPanelState();
}

class _AdminSeasonPanelState extends State<AdminSeasonPanel> {
  late final TextEditingController _season = TextEditingController(
    // Only a number an admin set is pre-filled; a guess stays empty, so the box shows what is
    // stored rather than making a guess look like a decision.
    text: widget.series.seasonFromName || widget.series.season == null ? '' : '${widget.series.season}',
  );
  bool _saving = false;
  String? _error;
  EpisodeMatchResult? _result;

  @override
  void dispose() {
    _season.dispose();
    super.dispose();
  }

  String get _hint {
    if (!widget.series.seasonFromName) {
      return "Set by hand. Clear the box to go back to guessing from the folder's name.";
    }
    return widget.series.season == null
        ? "Nothing in the name says which season this is, so its episodes aren't being named. Type the number."
        : "Guessed season ${widget.series.season} from the folder's name. Type a number to override it.";
  }

  Future<void> _save() async {
    final text = _season.text.trim();
    final season = text.isEmpty ? null : int.tryParse(text);
    if (text.isNotEmpty && season == null) {
      setState(() => _error = 'Season has to be a whole number.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final result = await AdminCatalogService.setFolderSeason(widget.folderId, season);
      if (!mounted) return;
      setState(() => _result = result);
      widget.onChanged();
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e is ApiException ? e.message : 'Failed — please try again.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final result = _result;
    return _panel(
      heading: 'Season',
      children: [
        Text.rich(
          TextSpan(
            style: _secondary,
            children: [
              const TextSpan(text: 'This folder sits inside '),
              TextSpan(
                text: widget.series.title,
                style: _secondary.copyWith(color: AppColors.foreground),
              ),
              const TextSpan(
                text: '. Its season number decides which TMDb episodes the videos in it are named after.',
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: TextField(
                controller: _season,
                keyboardType: TextInputType.number,
                onSubmitted: (_) => _save(),
                decoration: const InputDecoration(
                  labelText: 'Season number',
                  hintText: 'e.g. 2 — use 0 for specials',
                  isDense: true,
                ),
              ),
            ),
            const SizedBox(width: 8),
            ElevatedButton(
              onPressed: _saving ? null : _save,
              child: Text(_saving ? 'Saving…' : 'Save'),
            ),
          ],
        ),
        const SizedBox(height: 6),
        Text(_hint, style: _tertiary),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(_error!, style: const TextStyle(color: Color(0xFFF87171), fontSize: 13)),
          )
        else if (result != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              'Saved — named ${result.matched} episode${result.matched == 1 ? '' : 's'} across the series.',
              style: const TextStyle(color: AppColors.live, fontSize: 13),
            ),
          ),
      ],
    );
  }
}
