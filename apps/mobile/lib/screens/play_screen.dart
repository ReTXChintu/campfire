import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../services/api_client.dart';
import '../services/title_service.dart';
import '../theme/app_theme.dart';

/// `/play/movie/603?source=…`, `/play/tv/1396[?season=1&episode=2]&source=…` — what every Play
/// button opens (web routes/PlayPage.tsx). Asks the server where the title is watched — the
/// library's own page for it, or the title's (`/watch/tmdb:…`); a series carries on where the viewer
/// stopped — and goes there in its place, so Back doesn't bounce off it.
class PlayScreen extends StatefulWidget {
  final String type;
  final String tmdbId;
  final int? season;
  final int? episode;
  final String? source;

  const PlayScreen({super.key, required this.type, required this.tmdbId, this.season, this.episode, this.source});

  @override
  State<PlayScreen> createState() => _PlayScreenState();
}

class _PlayScreenState extends State<PlayScreen> {
  Object? _error;

  @override
  void initState() {
    super.initState();
    _go();
  }

  Future<void> _go() async {
    setState(() => _error = null);
    try {
      final href = await TitleService.playTarget(widget.type, widget.tmdbId, season: widget.season, episode: widget.episode);
      if (!mounted) return;
      final source = widget.source;
      context.replace(source == null ? href : '$href?source=${Uri.encodeQueryComponent(source)}');
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  void _back() => context.canPop() ? context.pop() : context.go('/');

  @override
  Widget build(BuildContext context) {
    final error = _error;
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Stack(
          children: [
            Center(
              child: error == null
                  ? const CircularProgressIndicator(color: Colors.white70)
                  : Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text("That can't be played", style: AppTheme.display(fontSize: 28), textAlign: TextAlign.center),
                          const SizedBox(height: 8),
                          Text(
                            error is ApiException ? error.message : 'Check your connection and try again.',
                            textAlign: TextAlign.center,
                            style: const TextStyle(color: AppColors.textSecondary, fontSize: 14),
                          ),
                          const SizedBox(height: 18),
                          FilledButton(autofocus: true, onPressed: _go, child: const Text('Try again')),
                        ],
                      ),
                    ),
            ),
            IconButton(
              tooltip: 'Back',
              icon: const Icon(Icons.arrow_back, color: AppColors.foreground),
              onPressed: _back,
            ),
          ],
        ),
      ),
    );
  }
}
