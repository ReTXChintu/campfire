import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import '../models/catalog.dart';
import '../services/catalog_service.dart';
import '../services/title_service.dart';
import '../services/watch_events.dart';
import '../services/watch_party_sync_controller.dart';
import '../widgets/media_kit_video_player.dart';
import '../widgets/source_panel.dart';
import '../widgets/watch_party_overlay.dart';
import '../widgets/web_player.dart';

class WatchScreen extends StatefulWidget {
  final String fileId;
  // The current ?party= query value, or null when no watch party is active — see app_router.dart.
  final String? partyId;
  // The source picked before getting here (`?source=`), or null.
  final String? source;

  const WatchScreen({super.key, required this.fileId, this.partyId, this.source});

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

  // Which source is on, the ones that failed, and where to carry on from after a switch (web
  // WatchPage's PlayerPick). `_attempt` remounts the player when the same source is tried again.
  String? _chosen;
  final Set<String> _failed = {};
  double? _startAt;
  int _attempt = 0;
  bool _moving = false;

  @override
  void initState() {
    super.initState();
    _future = CatalogService.fetchVideo(widget.fileId);
    _partyId = widget.partyId;
    // Read by the player before it opens the stream: in a party, the party says where to start.
    _syncController.initialPartyId = widget.partyId;
  }

  @override
  void dispose() {
    _syncController.dispose();
    // After the player's own dispose-time progress save has been sent; listeners re-fetch, so the
    // screen underneath shows what was just watched. A tiny delay lets that save land first.
    Future.delayed(const Duration(milliseconds: 600), WatchEvents.notifyPlayerClosed);
    super.dispose();
  }

  void _handlePartyIdChanged(String? partyId) {
    setState(() => _partyId = partyId);
    final query = partyId == null ? '' : '?party=$partyId';
    context.replace('/watch/${widget.fileId}$query');
  }

  void _select(String id, double? position) => setState(() {
        _chosen = id;
        _failed.remove(id);
        _startAt = position ?? _startAt;
        _attempt++;
      });

  void _playerFailed(String id, double? position) => setState(() {
        _chosen = id;
        _failed.add(id);
        _startAt = position ?? _startAt;
      });

  void _leave(VideoResponse video) => context.canPop() ? context.pop() : context.go(video.backHref);

  String _withSource(String path, String? source) =>
      source == null ? path : '$path?source=${Uri.encodeQueryComponent(source)}';

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
          final error = snapshot.error;
          // The library has added this title since: watch it there.
          if (error is VideoMoved) {
            if (!_moving) {
              _moving = true;
              WidgetsBinding.instance.addPostFrameCallback((_) {
                if (mounted) context.replace(_withSource(error.href, widget.source));
              });
            }
            return const SizedBox.shrink();
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
          return _player(snapshot.data!);
        },
      ),
    );
  }

  Widget _player(VideoResponse video) {
    final players = video.players;
    final choices = playChoices(players, video.sources);
    // A title the library has no file for can't be in a party.
    final inParty = _partyId != null && !video.isTitle;
    final selected = pickSource(inParty: inParty, chosen: _chosen, requested: widget.source, choices: choices);
    final player = players.where((p) => p.id == selected).firstOrNull;
    final failedHere = !inParty && selected != null && (player == null || _failed.contains(selected));
    final title = [video.seriesTitle, video.title].whereType<String>().where((s) => s.isNotEmpty).join(': ');

    if (!inParty && (selected == null || failedHere)) {
      return SourcePanel(
        key: ValueKey('panel-$selected-$_attempt'),
        title: title.isEmpty ? 'This title' : title,
        tmdb: video.meta.tmdb,
        sources: choices,
        failed: selected == null
            ? null
            : choices.where((c) => c.id == selected).firstOrNull ?? ViewerSource(id: selected, name: 'that source'),
        onSelect: (id) => _select(id, null),
        onBack: () => _leave(video),
      );
    }

    final others = [for (final c in choices) if (c.id != selected) c];
    final next = video.nextFileId;

    if (!inParty && player != null && player.isWeb) {
      return WebPlayer(
        key: ValueKey('${video.fileId}-${player.id}-$_attempt'),
        video: video,
        player: player,
        startAt: _startAt ?? (video.initialCompleted ? 0 : video.initialPositionSeconds),
        others: others,
        onSelect: _select,
        onFailed: () => _playerFailed(player.id, null),
        onExit: () => _leave(video),
        onNext: next == null ? null : () => context.pushReplacement(_withSource('/watch/$next', player.id)),
      );
    }

    if (!inParty && player != null && player.kind == PlayerKind.stream) {
      return _HostedPlayer(
        key: ValueKey('${video.fileId}-${player.id}-$_attempt'),
        video: video,
        player: player,
        sources: choices,
        startAt: _startAt,
        onFailed: (position) => _playerFailed(player.id, position),
        onSwitchSource: _select,
      );
    }

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
    final driveId = player?.id ?? 'drive';
    return WatchPartyOverlay(
      key: ValueKey(video.fileId),
      fileId: video.fileId,
      videoTitle: video.title,
      partyId: _partyId,
      onPartyIdChanged: _handlePartyIdChanged,
      syncController: _syncController,
      child: MediaKitVideoPlayer(
        key: ValueKey('${video.fileId}-$driveId-$_attempt'),
        video: video,
        watchPartySync: _syncController,
        sourceId: inParty ? null : driveId,
        sources: inParty ? const [] : choices,
        features: player?.features ?? const PlayerFeatures(),
        startAt: inParty ? null : _startAt,
        // With nowhere else to go, its own message says what's wrong.
        onFailed: !inParty && choices.length > 1 ? (position) => _playerFailed(driveId, position) : null,
        onSwitchSource: inParty ? null : _select,
      ),
    );
  }
}

/// Plays a title from a video host (Bunny, Cloudflare) in Campfire's own player (web
/// StreamPlayer.tsx): asks the server for the stream's address — fresh every time, since it expires
/// — and fetches the caption files the host keeps beside it. One the host hasn't got is a failure.
class _HostedPlayer extends StatefulWidget {
  final VideoResponse video;
  final PlayerOption player;
  final List<ViewerSource> sources;
  final double? startAt;
  final void Function(double? positionSeconds) onFailed;
  final void Function(String sourceId, double? positionSeconds) onSwitchSource;

  const _HostedPlayer({
    super.key,
    required this.video,
    required this.player,
    required this.sources,
    required this.startAt,
    required this.onFailed,
    required this.onSwitchSource,
  });

  @override
  State<_HostedPlayer> createState() => _HostedPlayerState();
}

class _HostedPlayerState extends State<_HostedPlayer> {
  SourceStream? _stream;
  List<ConvertedSubtitle> _captions = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final SourceStream stream;
    try {
      stream = await TitleService.fetchSourceStream(widget.player.id, widget.video.fileId);
    } catch (_) {
      if (mounted) widget.onFailed(widget.startAt);
      return;
    }
    final first = widget.video.subtitles.length;
    final found = await Future.wait([
      for (final c in stream.captions)
        http
            .get(Uri.parse(c.url))
            .timeout(const Duration(seconds: 8))
            .then((res) => res.statusCode == 200 && res.body.startsWith('WEBVTT') ? res.body : null)
            .catchError((_) => null),
    ]);
    final captions = <ConvertedSubtitle>[];
    for (final (i, vtt) in found.indexed) {
      if (vtt == null) continue;
      final c = stream.captions[i];
      captions.add(ConvertedSubtitle(index: first + captions.length, language: c.language, title: c.label, vtt: vtt));
    }
    if (mounted) {
      setState(() {
        _stream = stream;
        _captions = captions;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final stream = _stream;
    if (stream == null) {
      return const SafeArea(child: Center(child: CircularProgressIndicator(color: Colors.white70)));
    }
    return MediaKitVideoPlayer(
      video: widget.video,
      stream: stream,
      extraSubtitles: _captions,
      sourceId: widget.player.id,
      sources: widget.sources,
      features: widget.player.features,
      startAt: widget.startAt,
      onFailed: widget.onFailed,
      onSwitchSource: widget.onSwitchSource,
    );
  }
}
