import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:video_player/video_player.dart';
import 'package:go_router/go_router.dart';
import '../config.dart';
import '../models/catalog.dart';
import '../services/catalog_service.dart';
import '../services/media_token_service.dart';
import '../services/vtt_parser.dart';
import '../theme/app_theme.dart';
import 'episodes_panel.dart';

const _speedOptions = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
const _hideControlsDelay = Duration(seconds: 3);
const _saveInterval = Duration(seconds: 10);
const _skipSeconds = 10;

String _formatTime(Duration d) {
  if (d.isNegative) d = Duration.zero;
  final h = d.inHours;
  final m = d.inMinutes.remainder(60);
  final s = d.inSeconds.remainder(60);
  final mm = h > 0 ? m.toString().padLeft(2, '0') : m.toString();
  final ss = s.toString().padLeft(2, '0');
  return h > 0 ? '$h:$mm:$ss' : '$mm:$ss';
}

/// One player for both playback modes, same split as the web app's VideoPlayer.tsx: native MP4 is
/// properly seekable (the platform player issues its own Range requests), MKV ("restart" mode) is
/// a live ffmpeg remux with no real duration/seek support of its own, so every seek/track change
/// tears down and recreates the controller pointed at a new `t=`/`audio=` offset.
///
/// Known simplification vs. the web player: restart-mode subtitles aren't supported here (the web
/// version streams a live, seek-position-dependent WebVTT fetch per the backend's own comments on
/// why that's slow to do at all — full-track extraction can take minutes on a large MKV). Native-mode
/// subtitles (the common case — everything that's gone through the admin Converter) work fully.
class CampfireVideoPlayer extends StatefulWidget {
  final VideoResponse video;

  const CampfireVideoPlayer({super.key, required this.video});

  @override
  State<CampfireVideoPlayer> createState() => _CampfireVideoPlayerState();
}

class _CampfireVideoPlayerState extends State<CampfireVideoPlayer> with WidgetsBindingObserver {
  VideoPlayerController? _controller;
  bool _isBuffering = true;
  bool _controlsVisible = true;
  bool _isFullscreen = false;
  bool _episodesOpen = false;
  bool _subtitleMenuOpen = false;
  bool _audioMenuOpen = false;
  bool _endedHandled = false;
  Timer? _hideTimer;
  DateTime _lastSave = DateTime.fromMillisecondsSinceEpoch(0);
  double _speed = 1;

  // restart-mode only
  double _baseOffsetSeconds = 0;
  int? _audioIndex;
  ProbeResult? _probe;

  // native-mode only
  int? _subtitleIndex; // index into widget.video.subtitles
  final Map<int, List<VttCue>> _parsedCues = {};

  String? _mediaToken;

  VideoResponse get video => widget.video;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);

    if (!video.isNative && !video.initialCompleted && video.initialPositionSeconds > 5) {
      _baseOffsetSeconds = video.initialPositionSeconds;
    }

    if (!video.isNative) {
      CatalogService.fetchProbe(video.fileId).then((probe) {
        if (mounted) setState(() => _probe = probe);
      }).catchError((_) {});
    }

    _bootstrap();
    _scheduleHide();
  }

  Future<void> _bootstrap() async {
    try {
      _mediaToken = await MediaTokenService.mint(video.fileId);
    } catch (_) {
      // Falls through with no token — the stream request will 401 rather than silently play an
      // unauthenticated URL; surfaces as a stuck buffering state, which is at least honest about
      // something being wrong instead of pretending playback works.
    }
    if (!mounted) return;
    await _initController(_currentUri());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _hideTimer?.cancel();
    _saveProgress();
    if (_isFullscreen) _restoreSystemChrome();
    _controller?.removeListener(_onTick);
    _controller?.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused || state == AppLifecycleState.detached) {
      _saveProgress(force: true);
    }
  }

  Uri _currentUri() {
    final params = <String, String>{if (_mediaToken != null) 'token': _mediaToken!};
    if (!video.isNative) {
      if (_baseOffsetSeconds > 0) params['t'] = _baseOffsetSeconds.floor().toString();
      if (_audioIndex != null) params['audio'] = _audioIndex.toString();
    }
    final base = '$apiBaseUrl/api/stream/${video.fileId}';
    return params.isEmpty ? Uri.parse(base) : Uri.parse(base).replace(queryParameters: params);
  }

  Future<void> _initController(Uri uri) async {
    final controller = VideoPlayerController.networkUrl(uri);
    _controller = controller;
    try {
      await controller.initialize();
    } catch (_) {
      if (mounted) setState(() => _isBuffering = false);
      return;
    }
    if (!mounted) {
      controller.dispose();
      return;
    }
    controller.addListener(_onTick);
    controller.setPlaybackSpeed(_speed);
    if (video.isNative && !video.initialCompleted && video.initialPositionSeconds > 5) {
      await controller.seekTo(Duration(milliseconds: (video.initialPositionSeconds * 1000).round()));
    }
    controller.play();
    setState(() => _isBuffering = false);
  }

  Future<void> _reload({double? seekTo, int? audioIndex}) async {
    final old = _controller;
    old?.removeListener(_onTick);
    setState(() {
      _isBuffering = true;
      if (seekTo != null) _baseOffsetSeconds = seekTo;
      if (audioIndex != null) _audioIndex = audioIndex;
    });
    await old?.pause();
    await old?.dispose();
    await _initController(_currentUri());
  }

  Duration get _absolutePosition {
    final local = _controller?.value.position ?? Duration.zero;
    if (video.isNative) return local;
    return Duration(seconds: _baseOffsetSeconds.floor()) + local;
  }

  Duration? get _effectiveDuration {
    if (video.isNative) {
      final d = _controller?.value.duration;
      if (d != null && d > Duration.zero) return d;
      return video.durationSeconds != null ? Duration(milliseconds: (video.durationSeconds! * 1000).round()) : null;
    }
    final probeDuration = _probe?.durationSeconds;
    if (probeDuration != null) return Duration(milliseconds: (probeDuration * 1000).round());
    return video.durationSeconds != null ? Duration(milliseconds: (video.durationSeconds! * 1000).round()) : null;
  }

  void _onTick() {
    if (!mounted) return;
    final controller = _controller;
    if (controller == null) return;

    final buffering = controller.value.isBuffering;
    if (buffering != _isBuffering) setState(() => _isBuffering = buffering);

    final duration = controller.value.duration;
    if (!_endedHandled &&
        duration > Duration.zero &&
        controller.value.position >= duration - const Duration(milliseconds: 300) &&
        !controller.value.isPlaying) {
      _endedHandled = true;
      _goToNext();
      return;
    }

    final now = DateTime.now();
    if (now.difference(_lastSave) >= _saveInterval) {
      _saveProgress();
    }

    setState(() {}); // cheap: drives the seek bar / subtitle overlay off _absolutePosition
  }

  void _saveProgress({bool force = false}) {
    final now = DateTime.now();
    if (!force && now.difference(_lastSave) < const Duration(seconds: 2)) return;
    _lastSave = now;
    final duration = _effectiveDuration;
    CatalogService.saveProgress(
      fileId: video.fileId,
      parentFolderId: video.parentFolderId,
      positionSeconds: _absolutePosition.inMilliseconds / 1000,
      durationSeconds: (duration?.inMilliseconds ?? 0) / 1000,
    ).catchError((_) {});
  }

  void _goToNext() {
    _saveProgress(force: true);
    final next = video.nextFileId;
    if (next != null) {
      context.pushReplacement('/watch/$next');
    }
  }

  void _scheduleHide() {
    _hideTimer?.cancel();
    _hideTimer = Timer(_hideControlsDelay, () {
      if (mounted && (_controller?.value.isPlaying ?? false) && !_episodesOpen && !_subtitleMenuOpen && !_audioMenuOpen) {
        setState(() => _controlsVisible = false);
      }
    });
  }

  void _showControls() {
    setState(() => _controlsVisible = true);
    _scheduleHide();
  }

  void _togglePlay() {
    final controller = _controller;
    if (controller == null) return;
    if (controller.value.isPlaying) {
      controller.pause();
      _saveProgress(force: true);
    } else {
      controller.play();
    }
    _showControls();
  }

  void _skip(int deltaSeconds) {
    final controller = _controller;
    if (controller == null) return;
    if (video.isNative) {
      final duration = controller.value.duration;
      var target = controller.value.position + Duration(seconds: deltaSeconds);
      if (target < Duration.zero) target = Duration.zero;
      if (duration > Duration.zero && target > duration) target = duration;
      controller.seekTo(target);
    } else {
      final target = (_baseOffsetSeconds + controller.value.position.inSeconds + deltaSeconds).clamp(0, double.infinity);
      _reload(seekTo: target.toDouble());
    }
    _showControls();
  }

  void _seekTo(double seconds) {
    if (video.isNative) {
      _controller?.seekTo(Duration(milliseconds: (seconds * 1000).round()));
    } else {
      _reload(seekTo: seconds);
    }
  }

  void _cycleSpeed() {
    final idx = _speedOptions.indexOf(_speed);
    final next = _speedOptions[(idx + 1) % _speedOptions.length];
    setState(() => _speed = next);
    _controller?.setPlaybackSpeed(next);
  }

  Future<void> _toggleFullscreen() async {
    if (_isFullscreen) {
      await _restoreSystemChrome();
      setState(() => _isFullscreen = false);
    } else {
      await SystemChrome.setPreferredOrientations([
        DeviceOrientation.landscapeLeft,
        DeviceOrientation.landscapeRight,
      ]);
      await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
      setState(() => _isFullscreen = true);
    }
  }

  Future<void> _restoreSystemChrome() async {
    await SystemChrome.setPreferredOrientations([
      DeviceOrientation.portraitUp,
      DeviceOrientation.portraitDown,
    ]);
    await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  }

  void _closePanels() {
    setState(() {
      _episodesOpen = false;
      _subtitleMenuOpen = false;
      _audioMenuOpen = false;
    });
    if (_controller?.value.isPlaying ?? false) {
      _scheduleHide();
    } else {
      _hideTimer?.cancel();
      setState(() => _controlsVisible = true);
    }
  }

  List<VttCue> _cuesFor(int index) {
    return _parsedCues.putIfAbsent(index, () => parseVtt(video.subtitles[index].vtt));
  }

  String? _currentSubtitleText() {
    if (!video.isNative || _subtitleIndex == null) return null;
    final cues = _cuesFor(_subtitleIndex!);
    return activeCueText(cues, _absolutePosition);
  }

  @override
  Widget build(BuildContext context) {
    final duration = _effectiveDuration;
    final position = _absolutePosition;
    final absolute = video.introStart != null && video.introEnd != null
        ? position.inSeconds >= video.introStart! && position.inSeconds < video.introEnd!
        : false;
    final showNext = video.outroStart != null && position.inSeconds >= video.outroStart! && video.nextFileId != null;
    final subtitleText = _currentSubtitleText();

    return PopScope(
      canPop: !_isFullscreen,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && _isFullscreen) _toggleFullscreen();
      },
      child: GestureDetector(
        onTap: _showControls,
        child: AspectRatio(
          aspectRatio: 16 / 9,
          child: ClipRRect(
            borderRadius: _isFullscreen ? BorderRadius.zero : BorderRadius.circular(8),
            child: ColoredBox(
              color: Colors.black,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  if (_controller != null && _controller!.value.isInitialized)
                    Center(
                      child: AspectRatio(
                        aspectRatio: _controller!.value.aspectRatio,
                        child: VideoPlayer(_controller!),
                      ),
                    ),

                  if (subtitleText != null)
                    Positioned(
                      left: 24,
                      right: 24,
                      bottom: _controlsVisible ? 96 : 24,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.7), borderRadius: BorderRadius.circular(4)),
                        child: Text(
                          subtitleText,
                          textAlign: TextAlign.center,
                          style: const TextStyle(color: Colors.white, fontSize: 15),
                        ),
                      ),
                    ),

                  if (_isBuffering)
                    const Center(child: CircularProgressIndicator(color: Colors.white70)),

                  if (!(_controller?.value.isPlaying ?? false) && !_isBuffering)
                    Center(
                      child: GestureDetector(
                        onTap: _togglePlay,
                        child: Container(
                          padding: const EdgeInsets.all(18),
                          decoration: BoxDecoration(color: Colors.black45, shape: BoxShape.circle),
                          child: const Icon(Icons.play_arrow, size: 40, color: Colors.white),
                        ),
                      ),
                    ),

                  if (absolute)
                    Positioned(
                      right: 12,
                      bottom: 90,
                      child: _pillButton('Skip Intro', () {
                        if (video.introEnd != null) _seekTo(video.introEnd!);
                      }),
                    ),
                  if (showNext)
                    Positioned(right: 12, bottom: 90, child: _pillButton('Next Episode ›', _goToNext)),

                  // Top bar
                  AnimatedOpacity(
                    opacity: _controlsVisible ? 1 : 0,
                    duration: const Duration(milliseconds: 200),
                    child: IgnorePointer(
                      ignoring: !_controlsVisible,
                      child: Container(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            colors: [Colors.black.withValues(alpha: 0.8), Colors.transparent],
                          ),
                        ),
                        padding: const EdgeInsets.all(12),
                        child: Row(
                          children: [
                            IconButton(
                              icon: const Icon(Icons.arrow_back, color: Colors.white),
                              onPressed: () {
                                if (_isFullscreen) {
                                  _toggleFullscreen();
                                } else if (context.canPop()) {
                                  context.pop();
                                } else {
                                  context.go(video.backHref);
                                }
                              },
                            ),
                            Expanded(
                              child: Text(
                                video.title,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w500),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),

                  // Bottom bar
                  Align(
                    alignment: Alignment.bottomCenter,
                    child: AnimatedOpacity(
                      opacity: _controlsVisible ? 1 : 0,
                      duration: const Duration(milliseconds: 200),
                      child: IgnorePointer(
                        ignoring: !_controlsVisible,
                        child: Container(
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              begin: Alignment.bottomCenter,
                              end: Alignment.topCenter,
                              colors: [Colors.black.withValues(alpha: 0.9), Colors.transparent],
                            ),
                          ),
                          padding: const EdgeInsets.fromLTRB(8, 24, 8, 4),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Row(
                                children: [
                                  const SizedBox(width: 8),
                                  Text(_formatTime(position), style: const TextStyle(color: Colors.white70, fontSize: 11)),
                                  Expanded(
                                    child: SliderTheme(
                                      data: SliderTheme.of(context).copyWith(
                                        trackHeight: 2,
                                        thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 6),
                                        overlayShape: const RoundSliderOverlayShape(overlayRadius: 12),
                                        activeTrackColor: Colors.white,
                                        inactiveTrackColor: Colors.white24,
                                        thumbColor: Colors.white,
                                      ),
                                      child: Slider(
                                        value: duration != null && duration.inMilliseconds > 0
                                            ? position.inMilliseconds.clamp(0, duration.inMilliseconds).toDouble()
                                            : 0,
                                        max: (duration?.inMilliseconds ?? 0).toDouble().clamp(1, double.infinity),
                                        onChanged: duration == null ? null : (value) => setState(() {}),
                                        onChangeEnd: duration == null
                                            ? null
                                            : (value) => _seekTo(value / 1000),
                                      ),
                                    ),
                                  ),
                                  Text(
                                    duration != null ? _formatTime(duration) : '--:--',
                                    style: const TextStyle(color: Colors.white70, fontSize: 11),
                                  ),
                                  const SizedBox(width: 8),
                                ],
                              ),
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Row(
                                    children: [
                                      IconButton(
                                        icon: const Icon(Icons.skip_previous, color: Colors.white),
                                        onPressed: video.previousFileId == null
                                            ? null
                                            : () => context.pushReplacement('/watch/${video.previousFileId}'),
                                      ),
                                      IconButton(
                                        icon: const Icon(Icons.replay_10, color: Colors.white),
                                        onPressed: () => _skip(-_skipSeconds),
                                      ),
                                      IconButton(
                                        icon: Icon(
                                          (_controller?.value.isPlaying ?? false) ? Icons.pause : Icons.play_arrow,
                                          color: Colors.white,
                                          size: 30,
                                        ),
                                        onPressed: _togglePlay,
                                      ),
                                      IconButton(
                                        icon: const Icon(Icons.forward_10, color: Colors.white),
                                        onPressed: () => _skip(_skipSeconds),
                                      ),
                                      IconButton(
                                        icon: const Icon(Icons.skip_next, color: Colors.white),
                                        onPressed: video.nextFileId == null
                                            ? null
                                            : () => context.pushReplacement('/watch/${video.nextFileId}'),
                                      ),
                                    ],
                                  ),
                                  Row(
                                    children: [
                                      TextButton(
                                        onPressed: _cycleSpeed,
                                        child: Text('${_speed}x', style: const TextStyle(color: Colors.white70, fontSize: 12)),
                                      ),
                                      if (video.isNative && video.subtitles.isNotEmpty)
                                        IconButton(
                                          icon: const Icon(Icons.subtitles_outlined, color: Colors.white, size: 20),
                                          onPressed: () => setState(() {
                                            _subtitleMenuOpen = !_subtitleMenuOpen;
                                            _audioMenuOpen = false;
                                            _episodesOpen = false;
                                            _hideTimer?.cancel();
                                            _controlsVisible = true;
                                          }),
                                        ),
                                      if (!video.isNative && (_probe?.audioTracks.length ?? 0) > 1)
                                        IconButton(
                                          icon: const Icon(Icons.audiotrack, color: Colors.white, size: 20),
                                          onPressed: () => setState(() {
                                            _audioMenuOpen = !_audioMenuOpen;
                                            _subtitleMenuOpen = false;
                                            _episodesOpen = false;
                                            _hideTimer?.cancel();
                                            _controlsVisible = true;
                                          }),
                                        ),
                                      if (video.episodes.isNotEmpty)
                                        IconButton(
                                          icon: const Icon(Icons.playlist_play, color: Colors.white, size: 22),
                                          onPressed: () => setState(() {
                                            _episodesOpen = !_episodesOpen;
                                            _subtitleMenuOpen = false;
                                            _audioMenuOpen = false;
                                            _hideTimer?.cancel();
                                            _controlsVisible = true;
                                          }),
                                        ),
                                      IconButton(
                                        icon: Icon(_isFullscreen ? Icons.fullscreen_exit : Icons.fullscreen, color: Colors.white),
                                        onPressed: _toggleFullscreen,
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),

                  if (_episodesOpen)
                    EpisodesPanel(
                      episodes: video.episodes,
                      progressByFileId: video.progressByFileId,
                      currentFileId: video.fileId,
                      onSelect: (id) => context.pushReplacement('/watch/$id'),
                      onClose: _closePanels,
                    ),

                  if (_subtitleMenuOpen) _subtitleMenu(),
                  if (_audioMenuOpen) _audioMenu(),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _pillButton(String label, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: Colors.black.withValues(alpha: 0.7),
          border: Border.all(color: Colors.white24),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Text(label, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 13)),
      ),
    );
  }

  Widget _sidePanel(String title, List<Widget> children) {
    return Positioned.fill(
      child: Row(
        children: [
          Expanded(child: GestureDetector(onTap: _closePanels, child: Container(color: Colors.black54))),
          Container(
            width: 260,
            color: const Color(0xF2141414),
            child: SafeArea(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.all(12),
                    child: Row(
                      children: [
                        Expanded(child: Text(title, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600))),
                        IconButton(icon: const Icon(Icons.close, color: Colors.white70), onPressed: _closePanels),
                      ],
                    ),
                  ),
                  Expanded(child: ListView(children: children)),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _subtitleMenu() {
    return _sidePanel('Subtitles', [
      RadioListTile<int?>(
        value: null,
        groupValue: _subtitleIndex,
        title: const Text('Off', style: TextStyle(color: Colors.white70)),
        activeColor: AppColors.accent,
        onChanged: (value) => setState(() => _subtitleIndex = value),
      ),
      ...video.subtitles.map((s) {
        final label = s.language ?? s.title ?? 'Track ${s.index}';
        return RadioListTile<int?>(
          value: s.index,
          groupValue: _subtitleIndex,
          title: Text(label, style: const TextStyle(color: Colors.white70)),
          activeColor: AppColors.accent,
          onChanged: (value) => setState(() => _subtitleIndex = value),
        );
      }),
    ]);
  }

  Widget _audioMenu() {
    final tracks = _probe?.audioTracks ?? [];
    return _sidePanel('Audio Track', [
      ...tracks.map((t) {
        final label = '${t.language ?? 'Track ${t.index}'} (${t.codecName.toUpperCase()})';
        return RadioListTile<int?>(
          value: t.index,
          groupValue: _audioIndex ?? tracks.first.index,
          title: Text(label, style: const TextStyle(color: Colors.white70)),
          activeColor: AppColors.accent,
          onChanged: (value) {
            _closePanels();
            if (value != null) _reload(seekTo: _absolutePosition.inSeconds.toDouble(), audioIndex: value);
          },
        );
      }),
    ]);
  }
}
