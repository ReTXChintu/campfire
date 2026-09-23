import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../models/catalog.dart';
import '../services/catalog_service.dart';
import '../services/watch_party_sync_controller.dart';
import '../widgets/media_kit_video_player.dart';
import '../widgets/watch_party_overlay.dart';

class WatchScreen extends StatefulWidget {
  final String fileId;
  // The current ?party= query value, or null when no watch party is active — see app_router.dart.
  final String? partyId;

  const WatchScreen({super.key, required this.fileId, this.partyId});

  @override
  State<WatchScreen> createState() => _WatchScreenState();
}

class _WatchScreenState extends State<WatchScreen> {
  late Future<VideoResponse> _future;
  // Mirrors widget.partyId but lets WatchPartyOverlay change it locally (join/leave/create) without
  // waiting on a full route round-trip — pushed back into the URL so it survives a rebuild/rotation.
  String? _partyId;
  // Owned here (not by WatchPartyOverlay or the player) since it's the only channel through which
  // those two otherwise-unrelated widgets talk to each other — see watch_party_sync_controller.dart.
  final _syncController = WatchPartySyncController();

  @override
  void initState() {
    super.initState();
    _future = CatalogService.fetchVideo(widget.fileId);
    _partyId = widget.partyId;
  }

  @override
  void dispose() {
    _syncController.dispose();
    super.dispose();
  }

  void _handlePartyIdChanged(String? partyId) {
    setState(() => _partyId = partyId);
    final query = partyId == null ? '' : '?party=$partyId';
    context.replace('/watch/${widget.fileId}$query');
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

          // Wraps the player rather than sitting beside it in a Stack — keeps Watch Party
          // deliberately isolated from MediaKitVideoPlayer's own internals (the two only ever talk
          // to each other through _syncController), while letting the overlay itself decide
          // per-platform whether party chrome floats over the player or narrows it in a docked side
          // panel (see watch_party_overlay.dart's usesDockedPartyPanel branch).
          //
          // One player for everything (libmpv via media_kit — see media_kit_video_player.dart):
          // it decodes any container directly, so MKV, native mp4 and restart-mode content all go
          // through it on every platform. Rebuilding with a fresh key on fileId change (episode nav
          // via pushReplacement) forces it to tear down and recreate its controller for the new
          // video. Not wrapped in SafeArea/Center: the player fills the whole screen edge-to-edge
          // and letterboxes only the video itself, so its overlaid controls stay pinned to the true
          // screen edges instead of centering within a fixed 16:9 box.
          return WatchPartyOverlay(
            key: ValueKey(widget.fileId),
            fileId: video.fileId,
            videoTitle: video.title,
            partyId: _partyId,
            onPartyIdChanged: _handlePartyIdChanged,
            syncController: _syncController,
            child: MediaKitVideoPlayer(key: ValueKey(widget.fileId), video: video, watchPartySync: _syncController),
          );
        },
      ),
    );
  }
}
