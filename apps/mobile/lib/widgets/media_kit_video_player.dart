import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:media_kit/media_kit.dart';
import 'package:media_kit_video/media_kit_video.dart';
import '../config.dart';
import '../models/catalog.dart';
import '../services/catalog_service.dart';
import '../services/media_token_service.dart';
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

/// A libmpv-backed player (via media_kit) — CampfireVideoPlayer's alternative engine, used in two
/// situations: always on Windows (video_player has no Windows implementation at all — see
/// platform_info.dart's requiresMediaKitPlayer), and for MKV specifically everywhere else it's
/// supported (Android — see supportsMkvPlayback), since MKV's raw bytes are truly Range-seekable
/// (seekMode: "raw") and libmpv can demux the real container itself, unlike video_player.
///
/// Handles all three seekModes:
/// - "native"/"raw": real seeking via player.seek() — the backend serves true Range-seekable bytes
///   for both (see isRawStreamable in apps/backend/src/lib/drive.ts).
/// - "restart": the ffmpeg-remux fallback for anything else — no real Range support, so seeking
///   reopens the stream at a new `t=` offset instead, same trick CampfireVideoPlayer uses, and
///   duration/track info comes from a probe fetch rather than the (unreliable) live stream.
///
/// Known simplification: subtitle/audio tracks come from whatever libmpv finds embedded in the
/// container, not from `video.subtitles` (separately-uploaded/linked SubtitleSet VTT text) —
/// CampfireVideoPlayer's native-mode subtitle track list isn't reproduced here.
class MediaKitVideoPlayer extends StatefulWidget {
  final VideoResponse video;

  const MediaKitVideoPlayer({super.key, required this.video});

  @override
  State<MediaKitVideoPlayer> createState() => _MediaKitVideoPlayerState();
}

class _MediaKitVideoPlayerState extends State<MediaKitVideoPlayer> with WidgetsBindingObserver {
  late final Player _player = Player();
  late final VideoController _controller = VideoController(_player);
  final List<StreamSubscription> _subs = [];

  bool _isBuffering = true;
  bool _controlsVisible = true;
  bool _episodesOpen = false;
  bool _subtitleMenuOpen = false;
  bool _audioMenuOpen = false;
  bool _endedHandled = false;
  Timer? _hideTimer;
  DateTime _lastSave = DateTime.fromMillisecondsSinceEpoch(0);
  double _speed = 1;
  String? _mediaToken;
  String? _errorMessage;

  Duration _position = Duration.zero;
  Duration _duration = Duration.zero;
  bool _playing = false;
  Tracks _tracks = const Tracks();
  Track _track = const Track();
  ProbeResult? _probe; // restart-mode only — the live remux stream reports no reliable duration.

  VideoResponse get video => widget.video;

  // "native" and "raw" both serve true Range-seekable bytes (see isRawStreamable in
  // apps/backend/src/lib/drive.ts) — only "restart" (the ffmpeg-remux fallback) needs the
  // reopen-at-a-new-offset trick instead of a real seek.
  bool get _canSeekDirectly => video.isNative || video.isRaw;

  Duration get _effectiveDuration {
    if (_duration > Duration.zero) return _duration;
    final probeSeconds = _probe?.durationSeconds;
    if (probeSeconds != null) return Duration(milliseconds: (probeSeconds * 1000).round());
    final videoSeconds = video.durationSeconds;
    if (videoSeconds != null) return Duration(milliseconds: (videoSeconds * 1000).round());
    return Duration.zero;
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _enterImmersiveLandscape();
    _subs.addAll([
      _player.stream.position.listen((p) {
        if (!mounted) return;
        setState(() => _position = p);
        _maybeSave();
        _maybeAutoAdvance();
      }),
      _player.stream.duration.listen((d) {
        if (mounted) setState(() => _duration = d);
      }),
      _player.stream.playing.listen((p) {
        if (mounted) setState(() => _playing = p);
      }),
      _player.stream.buffering.listen((b) {
        if (mounted) setState(() => _isBuffering = b);
      }),
      _player.stream.tracks.listen((t) {
        if (mounted) setState(() => _tracks = t);
      }),
      _player.stream.track.listen((t) {
        if (mounted) setState(() => _track = t);
      }),
      _player.stream.completed.listen((completed) {
        if (completed) _goToNext();
      }),
      // Without this, a failed open (bad URL, network error, unsupported codec, ...) just leaves
      // the buffering spinner spinning forever with nothing in the UI explaining why.
      _player.stream.error.listen((message) {
        if (mounted) setState(() => _errorMessage = message);
      }),
    ]);
    _bootstrap();
    _scheduleHide();
  }

  Uri _streamUri({double restartOffsetSeconds = 0}) {
    final params = <String, String>{
      if (_mediaToken != null) 'token': _mediaToken!,
    };
    if (video.isRaw) {
      // Opts into the true byte-passthrough path for MKV (see routes/stream.ts) — without it the
      // backend defaults to the ffmpeg-remux "restart" behavior every other client gets.
      params['raw'] = '1';
    } else if (!video.isNative && restartOffsetSeconds > 0) {
      params['t'] = restartOffsetSeconds.floor().toString();
    }
    final base = '$apiBaseUrl/api/stream/${video.fileId}';
    return params.isEmpty ? Uri.parse(base) : Uri.parse(base).replace(queryParameters: params);
  }

  Future<void> _bootstrap() async {
    if (!video.isNative && !video.isRaw) {
      CatalogService.fetchProbe(video.fileId)
          .then((p) {
            if (mounted) setState(() => _probe = p);
          })
          .catchError((_) {});
    }

    try {
      _mediaToken = await MediaTokenService.mint(video.fileId);
    } catch (_) {
      // Falls through with no token — the stream request will 401 rather than silently play an
      // unauthenticated URL; surfaces as a stuck buffering state (now with a visible error, since
      // the backend's 401 response reaches libmpv's own error stream too).
    }
    if (!mounted) return;

    final resumeSeconds =
        (!video.initialCompleted && video.initialPositionSeconds > 5) ? video.initialPositionSeconds : 0.0;
    await _player.open(Media(_streamUri(restartOffsetSeconds: resumeSeconds).toString()));
    await _player.setRate(_speed);
    // Embedded subtitles default off, matching the native-mode player's default (no track
    // pre-selected) rather than libmpv's own default-flag-driven auto-selection.
    await _player.setSubtitleTrack(SubtitleTrack.no());
    if (resumeSeconds > 0 && _canSeekDirectly) {
      await _player.seek(Duration(milliseconds: (resumeSeconds * 1000).round()));
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _hideTimer?.cancel();
    for (final sub in _subs) {
      sub.cancel();
    }
    _saveProgress(force: true);
    _restoreSystemChrome();
    _player.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused || state == AppLifecycleState.detached) {
      _saveProgress(force: true);
    }
  }

  void _maybeSave() {
    final now = DateTime.now();
    if (now.difference(_lastSave) >= _saveInterval) _saveProgress();
  }

  void _saveProgress({bool force = false}) {
    final now = DateTime.now();
    if (!force && now.difference(_lastSave) < const Duration(seconds: 2)) return;
    _lastSave = now;
    CatalogService.saveProgress(
      fileId: video.fileId,
      parentFolderId: video.parentFolderId,
      positionSeconds: _position.inMilliseconds / 1000,
      durationSeconds: _effectiveDuration.inMilliseconds / 1000,
    ).catchError((_) {});
  }

  void _maybeAutoAdvance() {
    if (_endedHandled) return;
    final duration = _effectiveDuration;
    if (duration <= Duration.zero) return;
    if (_position >= duration - const Duration(milliseconds: 300) && !_playing) {
      _endedHandled = true;
      _goToNext();
    }
  }

  void _goToNext() {
    _saveProgress(force: true);
    final next = video.nextFileId;
    if (next != null) context.pushReplacement('/watch/$next');
  }

  void _scheduleHide() {
    _hideTimer?.cancel();
    _hideTimer = Timer(_hideControlsDelay, () {
      if (mounted && _playing && !_episodesOpen && !_subtitleMenuOpen && !_audioMenuOpen) {
        setState(() => _controlsVisible = false);
      }
    });
  }

  void _showControls() {
    setState(() => _controlsVisible = true);
    _scheduleHide();
  }

  void _togglePlay() {
    if (_playing) {
      _player.pause();
      _saveProgress(force: true);
    } else {
      _player.play();
    }
    _showControls();
  }

  Future<void> _reopenAt(double seconds) async {
    setState(() => _isBuffering = true);
    await _player.open(Media(_streamUri(restartOffsetSeconds: seconds).toString()));
    await _player.setRate(_speed);
  }

  void _skip(int deltaSeconds) {
    if (_canSeekDirectly) {
      var target = _position + Duration(seconds: deltaSeconds);
      if (target < Duration.zero) target = Duration.zero;
      final duration = _effectiveDuration;
      if (duration > Duration.zero && target > duration) target = duration;
      _player.seek(target);
    } else {
      final target = (_position.inSeconds + deltaSeconds).clamp(0, 1 << 30).toDouble();
      _reopenAt(target);
    }
    _showControls();
  }

  void _seekTo(double seconds) {
    if (_canSeekDirectly) {
      _player.seek(Duration(milliseconds: (seconds * 1000).round()));
    } else {
      _reopenAt(seconds);
    }
  }

  void _cycleSpeed() {
    final idx = _speedOptions.indexOf(_speed);
    final next = _speedOptions[(idx + 1) % _speedOptions.length];
    setState(() => _speed = next);
    _player.setRate(next);
  }

  Future<void> _enterImmersiveLandscape() async {
    await SystemChrome.setPreferredOrientations([
      DeviceOrientation.landscapeLeft,
      DeviceOrientation.landscapeRight,
    ]);
    await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
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
    if (_playing) {
      _scheduleHide();
    } else {
      _hideTimer?.cancel();
      setState(() => _controlsVisible = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final duration = _effectiveDuration;
    final position = _position;
    final introActive = video.introStart != null &&
        video.introEnd != null &&
        position.inSeconds >= video.introStart! &&
        position.inSeconds < video.introEnd!;
    final showNext =
        video.outroStart != null && position.inSeconds >= video.outroStart! && video.nextFileId != null;

    // Both lists always carry synthetic 'auto'/'no' entries around the real ones (see media_kit's
    // NativePlayer track-list parsing) — real tracks are whatever's left after excluding those.
    final realAudioTrackCount = _tracks.audio.length - 2;
    final hasSubtitles = video.subtitles.isNotEmpty || _tracks.subtitle.length > 2;

    return GestureDetector(
      onTap: _showControls,
      child: ColoredBox(
        color: Colors.black,
        child: Stack(
          fit: StackFit.expand,
          children: [
            Video(controller: _controller, controls: NoVideoControls, fit: BoxFit.contain),

            if (_isBuffering) const Center(child: CircularProgressIndicator(color: Colors.white70)),

            if (!_playing && !_isBuffering)
              Center(
                child: GestureDetector(
                  onTap: _togglePlay,
                  child: Container(
                    padding: const EdgeInsets.all(18),
                    decoration: const BoxDecoration(color: Colors.black45, shape: BoxShape.circle),
                    child: const Icon(Icons.play_arrow, size: 40, color: Colors.white),
                  ),
                ),
              ),

            if (_errorMessage != null)
              Positioned(
                left: 16,
                right: 16,
                top: 64,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: Colors.red.shade900.withValues(alpha: 0.85),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    _errorMessage!,
                    style: const TextStyle(color: Colors.white, fontSize: 12),
                  ),
                ),
              ),

            if (introActive)
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
                          if (context.canPop()) {
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
                                  value: duration.inMilliseconds > 0
                                      ? position.inMilliseconds.clamp(0, duration.inMilliseconds).toDouble()
                                      : 0,
                                  max: duration.inMilliseconds.toDouble().clamp(1, double.infinity),
                                  onChanged: duration.inMilliseconds <= 0 ? null : (value) => setState(() {}),
                                  onChangeEnd:
                                      duration.inMilliseconds <= 0 ? null : (value) => _seekTo(value / 1000),
                                ),
                              ),
                            ),
                            Text(
                              duration.inMilliseconds > 0 ? _formatTime(duration) : '--:--',
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
                                    _playing ? Icons.pause : Icons.play_arrow,
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
                                  child: Text(
                                    '${_speed}x',
                                    style: const TextStyle(color: Colors.white70, fontSize: 12),
                                  ),
                                ),
                                if (hasSubtitles)
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
                                if (realAudioTrackCount > 1)
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
          Expanded(
            child: GestureDetector(onTap: _closePanels, child: Container(color: Colors.black54)),
          ),
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
                        Expanded(
                          child: Text(title, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
                        ),
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
    // Two independent sources: tracks actually muxed into the container (rare in practice for
    // this library — most releases ship subtitles as a sibling file, not embedded), and
    // `video.subtitles` — the admin-curated SubtitleSet tracks CampfireVideoPlayer's native mode
    // already uses, loaded here via SubtitleTrack.data() since media_kit can play VTT text
    // directly without needing a container track at all.
    final embedded = _tracks.subtitle.where((t) => t.id != 'auto' && t.id != 'no').toList();
    final external = video.subtitles
        .map((s) => (
              subtitle: s,
              track: SubtitleTrack.data(s.vtt, title: s.title, language: s.language),
            ))
        .toList();

    return _sidePanel('Subtitles', [
      RadioListTile<String>(
        value: 'no',
        groupValue: _track.subtitle.id,
        title: const Text('Off', style: TextStyle(color: Colors.white70)),
        activeColor: AppColors.accent,
        onChanged: (_) {
          _player.setSubtitleTrack(SubtitleTrack.no());
          _closePanels();
        },
      ),
      ...external.map((entry) {
        final label = entry.subtitle.language ?? entry.subtitle.title ?? 'Track ${entry.subtitle.index}';
        return RadioListTile<String>(
          value: entry.track.id,
          groupValue: _track.subtitle.id,
          title: Text(label, style: const TextStyle(color: Colors.white70)),
          activeColor: AppColors.accent,
          onChanged: (_) {
            _player.setSubtitleTrack(entry.track);
            _closePanels();
          },
        );
      }),
      ...embedded.map((t) {
        final label = t.language ?? t.title ?? 'Embedded track ${t.id}';
        return RadioListTile<String>(
          value: t.id,
          groupValue: _track.subtitle.id,
          title: Text(label, style: const TextStyle(color: Colors.white70)),
          activeColor: AppColors.accent,
          onChanged: (_) {
            _player.setSubtitleTrack(t);
            _closePanels();
          },
        );
      }),
    ]);
  }

  Widget _audioMenu() {
    final real = _tracks.audio.where((t) => t.id != 'no').toList();
    return _sidePanel(
      'Audio Track',
      real.map((t) {
        final label = t.id == 'auto' ? 'Default' : (t.language ?? t.title ?? 'Track ${t.id}');
        return RadioListTile<String>(
          value: t.id,
          groupValue: _track.audio.id,
          title: Text(label, style: const TextStyle(color: Colors.white70)),
          activeColor: AppColors.accent,
          onChanged: (_) {
            _player.setAudioTrack(t);
            _closePanels();
          },
        );
      }).toList(),
    );
  }
}
