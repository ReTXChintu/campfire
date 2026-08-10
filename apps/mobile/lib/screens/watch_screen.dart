import 'package:flutter/material.dart';
import '../models/catalog.dart';
import '../services/catalog_service.dart';
import '../widgets/campfire_video_player.dart';

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
      body: SafeArea(
        child: Center(
          child: FutureBuilder<VideoResponse>(
            future: _future,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const CircularProgressIndicator(color: Colors.white70);
              }
              if (snapshot.hasError) {
                return const Text('Not found', style: TextStyle(color: Colors.white70));
              }
              // Rebuilding with a fresh key on fileId change (episode nav via pushReplacement)
              // forces the player to tear down and recreate its controller for the new video.
              return CampfireVideoPlayer(key: ValueKey(widget.fileId), video: snapshot.data!);
            },
          ),
        ),
      ),
    );
  }
}
