import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/catalog.dart';
import '../theme/app_theme.dart';

/// A title with embedded players: offers them, best first, and the library's own file. They open in
/// the browser, where the provider's player can run. The server has already left out any its
/// provider says are gone; one that can't be opened at all falls through to [onUseLibrary].
class EmbedPlayer extends StatelessWidget {
  final VideoResponse video;
  final VoidCallback onUseLibrary;

  const EmbedPlayer({super.key, required this.video, required this.onUseLibrary});

  Future<void> _open(String url) async {
    var opened = false;
    try {
      opened = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    } catch (_) {
      // No browser on this device (most TVs).
    }
    if (!opened) onUseLibrary();
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Stack(
        children: [
          Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(24, 56, 24, 24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    video.title,
                    textAlign: TextAlign.center,
                    style: AppTheme.display(fontSize: 32),
                  ),
                  const SizedBox(height: 20),
                  Wrap(
                    alignment: WrapAlignment.center,
                    spacing: 10,
                    runSpacing: 10,
                    children: [
                      for (final (i, embed) in video.embeds.indexed)
                        if (i == 0)
                          FilledButton.icon(
                            autofocus: true,
                            icon: const Icon(Icons.play_arrow),
                            label: Text('Play on ${embed.provider}'),
                            onPressed: () => _open(embed.url),
                          )
                        else
                          OutlinedButton(
                            onPressed: () => _open(embed.url),
                            child: Text('Try ${embed.provider}'),
                          ),
                      OutlinedButton(
                        onPressed: onUseLibrary,
                        child: const Text('Play from the library'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  const Text(
                    'Opens in your browser.',
                    style: TextStyle(color: AppColors.textTertiary, fontSize: 13),
                  ),
                ],
              ),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.arrow_back, color: Colors.white),
            tooltip: 'Back',
            onPressed: () => context.canPop() ? context.pop() : context.go(video.backHref),
          ),
        ],
      ),
    );
  }
}
