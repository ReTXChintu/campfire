import 'package:flutter/material.dart';
import '../models/catalog.dart';
import '../platform_info.dart';
import '../services/catalog_service.dart';
import '../theme/app_theme.dart';
import '../widgets/campfire_video_player.dart';
import '../widgets/media_kit_video_player.dart';

class WatchScreen extends StatefulWidget {
  final String fileId;

  const WatchScreen({super.key, required this.fileId});

  @override
  State<WatchScreen> createState() => _WatchScreenState();
}

class _WatchScreenState extends State<WatchScreen> {
  late Future<VideoResponse> _future;

  @override
  void initState() {
    super.initState();
    _future = CatalogService.fetchVideo(widget.fileId);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: FutureBuilder<VideoResponse>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const SafeArea(
              child: Center(
                child: CircularProgressIndicator(color: Colors.white70),
              ),
            );
          }
          if (snapshot.hasError) {
            return const SafeArea(
              child: Center(
                child: Text(
                  'Not found',
                  style: TextStyle(color: Colors.white70),
                ),
              ),
            );
          }
          final video = snapshot.data!;

          // Rebuilding with a fresh key on fileId change (episode nav via pushReplacement)
          // forces the player to tear down and recreate its controller for the new video.
          // Not wrapped in SafeArea/Center: the player fills the whole screen edge-to-edge
          // and letterboxes only the video itself, so its overlaid controls stay pinned to
          // the true screen edges instead of centering within a fixed 16:9 box.
          if (video.isRaw) {
            // MKV — a completely different player (libmpv via media_kit, see
            // widgets/media_kit_video_player.dart), only wired up on Windows/Android (see
            // platform_info.dart). Anywhere else this build could theoretically run (iOS), there's
            // no native MKV decoder plugged in, so it gets the same "get the app" messaging web
            // shows rather than a broken player.
            return supportsMkvPlayback
                ? MediaKitVideoPlayer(key: ValueKey(widget.fileId), video: video)
                : const _MkvUnsupportedNotice();
          }
          if (requiresMediaKitPlayer) {
            // Windows — video_player (CampfireVideoPlayer's engine) has no Windows implementation
            // at all, so every video goes through media_kit here, not just MKV.
            return MediaKitVideoPlayer(key: ValueKey(widget.fileId), video: video);
          }
          return CampfireVideoPlayer(key: ValueKey(widget.fileId), video: video);
        },
      ),
    );
  }
}

class _MkvUnsupportedNotice extends StatelessWidget {
  const _MkvUnsupportedNotice();

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('This video needs the Windows or Android app', style: AppTheme.display(fontSize: 22)),
              const SizedBox(height: 8),
              const Text(
                'This video is an MKV file and isn\'t supported on this platform yet.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.textSecondary),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
