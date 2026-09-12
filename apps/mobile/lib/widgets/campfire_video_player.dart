import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:video_player/video_player.dart';
import 'package:go_router/go_router.dart';
import '../config.dart';
import '../models/catalog.dart';
import '../models/watch_party.dart';
import '../services/catalog_service.dart';
import '../services/media_token_service.dart';
import '../services/quality_prefs_service.dart';
import '../services/vtt_parser.dart';
import '../services/watch_party_sync_controller.dart';
import '../theme/app_theme.dart';
import 'episodes_panel.dart';

const _speedOptions = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
const _hideControlsDelay = Duration(seconds: 3);
const _saveInterval = Duration(seconds: 10);
const _skipSeconds = 10;

// Auto-mode quality heuristic — same constants and shape as the web player's / MediaKitVideoPlayer's
// (kept in sync by hand, no shared code across TS/Dart): react to buffering events, not real
// throughput/segment measurement. Deliberately MVP-realistic, not broadcast-grade ABR.
const _autoWindow = Duration(seconds: 30);
const _autoStepDownEventCount = 2;
const _autoStallDuration = Duration(seconds: 4);
const _autoSustained = Duration(seconds: 180);
const _autoCooldown = Duration(seconds: 60);

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
  // Set by WatchScreen only while a watch party is active for this video — see
  // watch_party_sync_controller.dart. Null means "no party", exactly like today.
  final WatchPartySyncController? watchPartySync;

  const CampfireVideoPlayer({super.key, required this.video, this.watchPartySync});

  @override
  State<CampfireVideoPlayer> createState() => _CampfireVideoPlayerState();
}

class _CampfireVideoPlayerState extends State<CampfireVideoPlayer>
    with WidgetsBindingObserver {
  VideoPlayerController? _controller;
  bool _isBuffering = true;
  bool _controlsVisible = true;
  bool _episodesOpen = false;
  bool _subtitleMenuOpen = false;
  bool _audioMenuOpen = false;
  bool _qualityMenuOpen = false;
  bool _endedHandled = false;
  Timer? _hideTimer;
  DateTime _lastSave = DateTime.fromMillisecondsSinceEpoch(0);
  double _speed = 1;

  // restart-mode (or any downscaled quality) only
  double _baseOffsetSeconds = 0;
  int? _audioIndex;
  ProbeResult? _probe;

  // native-mode only
  int? _subtitleIndex; // index into widget.video.subtitles
  final Map<int, List<VttCue>> _parsedCues = {};

  // Remembered-preference state, saved to the backend on every progress save (see
  // apps/backend/src/lib/progress.ts) and reapplied on future opens of this video, on any
  // player/platform. This player's subtitle picker only ever offers `video.subtitles` entries
  // (native mode only — restart-mode subtitles aren't supported here at all, see the README), so
  // subtitleSource is always "external" or "off", never "restart". Audio is matched by
  // language+title (an absolute ffprobe stream index isn't stable across players — MediaKit uses
  // mpv's own track ids instead).
  String? _subtitlePreferenceSource; // "off" | "external" | null (nothing to save yet)
  int? _subtitlePreferenceIndex;
  String? _audioPreferenceLanguage;
  String? _audioPreferenceTitle;
  bool _hasAudioPreference = false; // distinguishes "no preference" from "prefers null/null"

  String? _mediaToken;
  Offset? _doubleTapLocalPosition;

  // Watch Party sync — see watch_party_sync_controller.dart. Set true for the duration of
  // _applyInboundSyncState so the seek/play/pause calls it makes don't get re-broadcast as if they
  // were a local user action (mirrors VideoPlayer.tsx's applyingInboundSyncRef).
  bool _applyingInboundSync = false;

  // Sync only ever applies to native-mode content (matches web's seekMode === "native" gate) — MKV
  // never reaches this player at all, and "restart" mode's reload-at-t= seeking isn't precise
  // enough for another device's position to mean much here.
  bool get _syncEnabled => video.isNative && widget.watchPartySync != null;
  // Anyone without playback control can't seek/skip/change speed during a synced party — those
  // actions would silently desync them until the controller's next broadcast, with no indication
  // anything "failed". Doesn't lock play/pause — pausing locally is harmless, it just won't stick
  // once the next inbound sync arrives.
  bool get _locked => _syncEnabled && !(widget.watchPartySync?.canControl ?? false);

  // "auto" | "original" | "<height>" — mirrors QualitySelection on web (Dart has no union types).
  String _qualitySelection = 'auto';
  int? _autoResolvedHeight;
  DateTime? _autoStallStart;
  final List<DateTime> _autoBufferEvents = [];
  DateTime _autoLastChange = DateTime.fromMillisecondsSinceEpoch(0);
  DateTime _autoStableSince = DateTime.now();
  Timer? _autoStepUpTimer;
  bool _autoWasBuffering = false;

  VideoResponse get video => widget.video;

  int? get _effectiveHeight {
    if (_qualitySelection == 'auto') return _autoResolvedHeight;
    if (_qualitySelection == 'original') return null;
    return int.tryParse(_qualitySelection);
  }

  List<int> get _ladderHeights => (_probe?.availableQualities ?? const []).map((q) => q.height).toList();

  // True only for real Range-seekable byte passthrough — native content at its own source
  // resolution. This player never sees seekMode "raw" (MKV never routes here, see
  // watch_screen.dart), so unlike MediaKitVideoPlayer this only ever checks video.isNative.
  bool get _usingPassthrough => video.isNative && _effectiveHeight == null;

  // True for passthrough OR any specific quality tier — every tier the quality menu offers is a
  // pre-generated file with real Range support of its own (see lib/renditions.ts on the backend),
  // not a live re-encode, so it's just as directly seekable as passthrough. Only true restart mode
  // (a non-native format at Original, no rendition involved — the live ffmpeg remux) has no real
  // seeking and needs the reload-at-`t=` trick instead.
  bool get _streamIsSeekable => _usingPassthrough || _effectiveHeight != null;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _enterImmersiveLandscape();

    if (!_usingPassthrough &&
        !video.initialCompleted &&
        video.initialPositionSeconds > 5) {
      _baseOffsetSeconds = video.initialPositionSeconds;
    }

    // Seed remembered track preferences from the last time this video was watched (by this user,
    // any player/platform — see apps/backend/src/lib/progress.ts). Subtitle applies immediately
    // (this player's subtitle rendering is a pure Flutter-side overlay reading `_subtitleIndex`,
    // no player-level call needed); audio needs probe data to resolve a language+title match to
    // an ffprobe stream index, so that happens once probe resolves below.
    _subtitlePreferenceSource = video.initialSubtitleSource == 'off' || video.initialSubtitleSource == 'external'
        ? video.initialSubtitleSource
        : null;
    _subtitlePreferenceIndex = video.initialSubtitleIndex;
    if (_subtitlePreferenceSource == 'external' && _subtitlePreferenceIndex != null) {
      _subtitleIndex = _subtitlePreferenceIndex;
    }
    if (video.initialAudioLanguage != null || video.initialAudioTitle != null) {
      _hasAudioPreference = true;
      _audioPreferenceLanguage = video.initialAudioLanguage;
      _audioPreferenceTitle = video.initialAudioTitle;
    }

    // Probed for every video now (not just restart mode) — the quality menu needs
    // sourceHeight/availableQualities regardless of seekMode.
    CatalogService.fetchProbe(video.fileId)
        .then((probe) {
          if (!mounted) return;
          setState(() => _probe = probe);
          _maybeSeedAutoQuality(probe);
          _maybeApplyAudioPreference(probe);
        })
        .catchError((_) {});

    _autoStepUpTimer = Timer.periodic(_autoWindow, (_) {
      if (mounted && _qualitySelection == 'auto' && (_controller?.value.isPlaying ?? false)) {
        _autoStepUp();
      }
    });

    _bootstrap();
    _scheduleHide();
    widget.watchPartySync?.addListener(_onSyncControllerChanged);
  }

  // Fires whenever the sync controller's enabled/canControl/inboundState changes — a new inbound
  // state (from whoever currently holds control) gets applied here; canControl flipping (a
  // grant/revoke) just needs a rebuild so the locked-out controls re-enable/disable.
  void _onSyncControllerChanged() {
    if (!mounted) return;
    final sync = widget.watchPartySync;
    if (sync != null && _syncEnabled && !sync.canControl) {
      final state = sync.inboundState;
      if (state != null) _applyInboundSyncState(state);
    }
    setState(() {});
  }

  void _applyInboundSyncState(WatchPartySyncState state) {
    final controller = _controller;
    if (controller == null) return;
    final updatedAt = DateTime.tryParse(state.updatedAt) ?? DateTime.now();
    final elapsedSeconds = DateTime.now().difference(updatedAt).inMilliseconds / 1000;
    final targetSeconds = (state.positionSeconds + (state.playing ? elapsedSeconds * state.playbackRate : 0))
        .clamp(0, double.infinity)
        .toDouble();

    _applyingInboundSync = true;
    if (_speed != state.playbackRate) {
      setState(() => _speed = state.playbackRate);
      controller.setPlaybackSpeed(state.playbackRate);
    }
    _seekTo(targetSeconds);
    if (state.playing) {
      controller.play();
    } else {
      controller.pause();
    }
    // Cleared on the next microtask rather than immediately — _seekTo/controller.play() above may
    // themselves be asynchronous (a restart-mode _reload), and the guard needs to still be up for
    // any of their synchronous side effects this frame.
    Future.microtask(() => _applyingInboundSync = false);
  }

  // Called from every user/self-driven playback action (_togglePlay/_seekTo/_skip/_cycleSpeed) —
  // guarded so it's a no-op unless a party is active AND we currently hold control, and so
  // _applyInboundSyncState's own calls into those same methods never get re-broadcast right back
  // out (mirrors VideoPlayer.tsx's emitWatchPartyState + applyingInboundSyncRef pairing).
  void _maybeBroadcastPartyState({double? positionSecondsOverride}) {
    final sync = widget.watchPartySync;
    if (sync == null || _applyingInboundSync || !_syncEnabled || !sync.canControl) return;
    sync.broadcast(
      WatchPartySyncState(
        playing: _controller?.value.isPlaying ?? false,
        positionSeconds: positionSecondsOverride ?? (_absolutePosition.inMilliseconds / 1000),
        playbackRate: _speed,
        updatedAt: DateTime.now().toIso8601String(),
      ),
    );
  }

  // Seeds Auto's starting tier from this device's last learned ceiling once probe resolves (so a
  // known-weak device doesn't have to rediscover its ceiling via a rough patch on every video) —
  // clamped to this video's own ladder. Mirrors the web/MediaKitVideoPlayer equivalent.
  void _maybeSeedAutoQuality(ProbeResult probe) async {
    if (_qualitySelection != 'auto' || _autoResolvedHeight != null) return;
    final heights = probe.availableQualities.map((q) => q.height).toList();
    final remembered = await QualityPrefsService.getCeiling();
    if (!mounted || _qualitySelection != 'auto' || _autoResolvedHeight != null) return;
    if (remembered != null && heights.contains(remembered)) {
      _applyAutoChange(remembered);
    }
  }

  // Restart-mode audio track switching only (native mode has no audio-track picker on this
  // player) — matches the remembered preference by language+title against this file's real
  // ffprobe stream list, then reloads at the current position with that track selected. Runs once,
  // as soon as probe resolves; there's no later reopen that could need a repeat of this the way
  // MediaKitVideoPlayer's auto-quality reopens do, since this player's own quality/skip reloads
  // reuse whatever `_audioIndex` is already set to (see _currentUri/_reload).
  void _maybeApplyAudioPreference(ProbeResult probe) {
    if (!_hasAudioPreference || video.isNative || _audioIndex != null) return;
    for (final t in probe.audioTracks) {
      if (t.language == _audioPreferenceLanguage && t.title == _audioPreferenceTitle) {
        _reload(seekTo: _absolutePosition.inSeconds.toDouble(), audioIndex: t.index);
        return;
      }
    }
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
    _autoStepUpTimer?.cancel();
    _saveProgress();
    _restoreSystemChrome();
    _controller?.removeListener(_onTick);
    _controller?.dispose();
    widget.watchPartySync?.removeListener(_onSyncControllerChanged);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached) {
      _saveProgress(force: true);
    }
  }

  Uri _currentUri() {
    final params = <String, String>{
      if (_mediaToken != null) 'token': _mediaToken!,
    };
    final height = _effectiveHeight;
    if (height != null) params['h'] = height.toString();
    if (!_streamIsSeekable) {
      if (_baseOffsetSeconds > 0)
        params['t'] = _baseOffsetSeconds.floor().toString();
      if (!video.isNative && _audioIndex != null) params['audio'] = _audioIndex.toString();
    }
    final base = '$apiBaseUrl/api/stream/${video.fileId}';
    return params.isEmpty
        ? Uri.parse(base)
        : Uri.parse(base).replace(queryParameters: params);
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
    // A seekable resource (passthrough or a specific quality tier) has no `t=` URL param to resume
    // at (see _currentUri) — real Range seeking means a plain post-initialize seek works fine, same
    // trick the original mount-time resume already used, now also reused when a quality change
    // lands on such a resource mid-session (in which case `_baseOffsetSeconds`, set by `_reload`'s
    // `seekTo`, carries the position instead of `video.initialPositionSeconds`).
    if (_streamIsSeekable) {
      final resumeSeconds = _baseOffsetSeconds > 0
          ? _baseOffsetSeconds
          : (!video.initialCompleted && video.initialPositionSeconds > 5 ? video.initialPositionSeconds : 0);
      if (resumeSeconds > 0) {
        await controller.seekTo(Duration(milliseconds: (resumeSeconds * 1000).round()));
      }
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

  void _changeQuality(String value) {
    final position = _absolutePosition.inMilliseconds / 1000;
    setState(() => _qualitySelection = value);
    _reload(seekTo: position);
  }

  // Auto-mode's own quality changes reuse the exact same reload mechanics as a manual pick above —
  // the only difference is who decided the target height.
  void _applyAutoChange(int? newHeight) {
    if (newHeight == _autoResolvedHeight) return;
    final position = _absolutePosition.inMilliseconds / 1000;
    setState(() => _autoResolvedHeight = newHeight);
    QualityPrefsService.setCeiling(newHeight);
    _reload(seekTo: position);
  }

  void _autoStepDown() {
    final now = DateTime.now();
    if (now.difference(_autoLastChange) < _autoCooldown) return;
    final heights = _ladderHeights;
    if (heights.isEmpty) return;
    final current = _autoResolvedHeight;
    final next = current == null
        ? heights.last
        : heights[(heights.indexOf(current) - 1).clamp(0, heights.length - 1)];
    if (next == current) return;
    _autoLastChange = now;
    _autoStableSince = now;
    _autoBufferEvents.clear();
    _applyAutoChange(next);
  }

  void _autoStepUp() {
    final now = DateTime.now();
    if (now.difference(_autoLastChange) < _autoCooldown) return;
    if (now.difference(_autoStableSince) < _autoSustained) return;
    final current = _autoResolvedHeight;
    if (current == null) return; // already Original, nowhere higher to go
    final heights = _ladderHeights;
    final idx = heights.indexOf(current);
    final next = (idx == -1 || idx == heights.length - 1) ? null : heights[idx + 1];
    _autoLastChange = now;
    _autoStableSince = now;
    _applyAutoChange(next);
  }

  // video_player has no discrete buffering-event stream (unlike media_kit) — _onTick polls
  // `controller.value.isBuffering` on every controller update, so the auto heuristic watches for
  // edges in that same polled value instead of subscribing to anything separate.
  void _onAutoBufferingChanged(bool buffering) {
    if (_qualitySelection != 'auto') return;
    final now = DateTime.now();
    if (buffering) {
      _autoStallStart = now;
      _autoBufferEvents.add(now);
      _autoBufferEvents.removeWhere((t) => now.difference(t) > _autoWindow);
    } else {
      final stallStart = _autoStallStart;
      _autoStallStart = null;
      if (stallStart != null && now.difference(stallStart) >= _autoStallDuration) {
        _autoStepDown();
      } else if (_autoBufferEvents.length >= _autoStepDownEventCount) {
        _autoStepDown();
      }
    }
  }

  Duration get _absolutePosition {
    final local = _controller?.value.position ?? Duration.zero;
    if (_streamIsSeekable) return local;
    return Duration(seconds: _baseOffsetSeconds.floor()) + local;
  }

  Duration? get _effectiveDuration {
    if (_usingPassthrough) {
      final d = _controller?.value.duration;
      if (d != null && d > Duration.zero) return d;
      return video.durationSeconds != null
          ? Duration(milliseconds: (video.durationSeconds! * 1000).round())
          : null;
    }
    final probeDuration = _probe?.durationSeconds;
    if (probeDuration != null)
      return Duration(milliseconds: (probeDuration * 1000).round());
    return video.durationSeconds != null
        ? Duration(milliseconds: (video.durationSeconds! * 1000).round())
        : null;
  }

  void _onTick() {
    if (!mounted) return;
    final controller = _controller;
    if (controller == null) return;

    final buffering = controller.value.isBuffering;
    if (buffering != _isBuffering) {
      setState(() => _isBuffering = buffering);
    }
    if (buffering != _autoWasBuffering) {
      _autoWasBuffering = buffering;
      _onAutoBufferingChanged(buffering);
    }

    final duration = controller.value.duration;
    if (!_endedHandled &&
        duration > Duration.zero &&
        controller.value.position >=
            duration - const Duration(milliseconds: 300) &&
        !controller.value.isPlaying) {
      _endedHandled = true;
      _goToNext();
      return;
    }

    final now = DateTime.now();
    if (now.difference(_lastSave) >= _saveInterval) {
      _saveProgress();
    }

    setState(
      () {},
    ); // cheap: drives the seek bar / subtitle overlay off _absolutePosition
  }

  void _saveProgress({bool force = false}) {
    final now = DateTime.now();
    if (!force && now.difference(_lastSave) < const Duration(seconds: 2))
      return;
    _lastSave = now;
    final duration = _effectiveDuration;
    CatalogService.saveProgress(
      fileId: video.fileId,
      parentFolderId: video.parentFolderId,
      positionSeconds: _absolutePosition.inMilliseconds / 1000,
      durationSeconds: (duration?.inMilliseconds ?? 0) / 1000,
      subtitleSource: _subtitlePreferenceSource,
      subtitleIndex: _subtitlePreferenceSource == null ? unsetProgressField : _subtitlePreferenceIndex,
      audioLanguage: _hasAudioPreference ? _audioPreferenceLanguage : unsetProgressField,
      audioTitle: _hasAudioPreference ? _audioPreferenceTitle : unsetProgressField,
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
      if (mounted &&
          (_controller?.value.isPlaying ?? false) &&
          !_episodesOpen &&
          !_subtitleMenuOpen &&
          !_audioMenuOpen &&
          !_qualityMenuOpen) {
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
    _maybeBroadcastPartyState();
  }

  // Left third: -10s, middle third: play/pause, right third: +10s — same layout as most
  // streaming apps' double-tap gesture. _skip/_togglePlay already call _showControls().
  void _handleDoubleTap() {
    final pos = _doubleTapLocalPosition;
    if (pos == null) return;
    final width = MediaQuery.sizeOf(context).width;
    if (pos.dx < width / 3) {
      _skip(-_skipSeconds);
    } else if (pos.dx > width * 2 / 3) {
      _skip(_skipSeconds);
    } else {
      _togglePlay();
    }
  }

  void _skip(int deltaSeconds) {
    final controller = _controller;
    if (controller == null) return;
    double targetSeconds;
    if (_streamIsSeekable) {
      final duration = controller.value.duration;
      var target = controller.value.position + Duration(seconds: deltaSeconds);
      if (target < Duration.zero) target = Duration.zero;
      if (duration > Duration.zero && target > duration) target = duration;
      controller.seekTo(target);
      targetSeconds = target.inMilliseconds / 1000;
    } else {
      final target =
          (_baseOffsetSeconds +
                  controller.value.position.inSeconds +
                  deltaSeconds)
              .clamp(0, double.infinity);
      _reload(seekTo: target.toDouble());
      targetSeconds = target.toDouble();
    }
    _showControls();
    _maybeBroadcastPartyState(positionSecondsOverride: targetSeconds);
  }

  void _seekTo(double seconds) {
    if (_streamIsSeekable) {
      _controller?.seekTo(Duration(milliseconds: (seconds * 1000).round()));
    } else {
      _reload(seekTo: seconds);
    }
    _maybeBroadcastPartyState(positionSecondsOverride: seconds);
  }

  void _cycleSpeed() {
    final idx = _speedOptions.indexOf(_speed);
    final next = _speedOptions[(idx + 1) % _speedOptions.length];
    setState(() => _speed = next);
    _controller?.setPlaybackSpeed(next);
    _maybeBroadcastPartyState();
  }

  /// Watching is always landscape + immersive (status/nav bars hidden) — entered as soon as this
  /// screen mounts, not gated behind a manual toggle. Reverted in `_restoreSystemChrome` on exit.
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
      _qualityMenuOpen = false;
    });
    if (_controller?.value.isPlaying ?? false) {
      _scheduleHide();
    } else {
      _hideTimer?.cancel();
      setState(() => _controlsVisible = true);
    }
  }

  List<VttCue> _cuesFor(int index) {
    return _parsedCues.putIfAbsent(
      index,
      () => parseVtt(video.subtitles[index].vtt),
    );
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
        ? position.inSeconds >= video.introStart! &&
              position.inSeconds < video.introEnd!
        : false;
    final showNext =
        video.outroStart != null &&
        position.inSeconds >= video.outroStart! &&
        video.nextFileId != null;
    final subtitleText = _currentSubtitleText();

    return Focus(
      autofocus: true,
      onKeyEvent: (node, event) {
        if (event is KeyDownEvent && event.logicalKey == LogicalKeyboardKey.space) {
          _togglePlay();
          return KeyEventResult.handled;
        }
        return KeyEventResult.ignored;
      },
      child: GestureDetector(
      onTap: _showControls,
      onDoubleTapDown: (details) => _doubleTapLocalPosition = details.localPosition,
      onDoubleTap: _handleDoubleTap,
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
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.7),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    subtitleText,
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.white, fontSize: 15),
                  ),
                ),
              ),

            if (_isBuffering)
              const Center(
                child: CircularProgressIndicator(color: Colors.white70),
              ),

            if (!(_controller?.value.isPlaying ?? false) && !_isBuffering)
              Center(
                child: GestureDetector(
                  onTap: _togglePlay,
                  child: Container(
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                      color: Colors.black45,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.play_arrow,
                      size: 40,
                      color: Colors.white,
                    ),
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
              Positioned(
                right: 12,
                bottom: 90,
                child: _pillButton('Next Episode ›', _goToNext),
              ),

            // Top bar — Align pins it to the top; without it, StackFit.expand stretches this
            // Container to fill the whole stack and the Row inside ends up vertically centered
            // in the entire video area instead of pinned to the top.
            Align(
              alignment: Alignment.topCenter,
              child: AnimatedOpacity(
                opacity: _controlsVisible ? 1 : 0,
                duration: const Duration(milliseconds: 200),
                child: IgnorePointer(
                  ignoring: !_controlsVisible,
                  child: Container(
                    width: double.infinity,
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [
                          Colors.black.withValues(alpha: 0.8),
                          Colors.transparent,
                        ],
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
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 14,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ),
                      ],
                    ),
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
                        colors: [
                          Colors.black.withValues(alpha: 0.9),
                          Colors.transparent,
                        ],
                      ),
                    ),
                    padding: const EdgeInsets.fromLTRB(8, 24, 8, 4),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Row(
                          children: [
                            const SizedBox(width: 8),
                            Text(
                              _formatTime(position),
                              style: const TextStyle(
                                color: Colors.white70,
                                fontSize: 11,
                              ),
                            ),
                            Expanded(
                              child: SliderTheme(
                                data: SliderTheme.of(context).copyWith(
                                  trackHeight: 2,
                                  thumbShape: const RoundSliderThumbShape(
                                    enabledThumbRadius: 6,
                                  ),
                                  overlayShape: const RoundSliderOverlayShape(
                                    overlayRadius: 12,
                                  ),
                                  activeTrackColor: Colors.white,
                                  inactiveTrackColor: Colors.white24,
                                  thumbColor: Colors.white,
                                ),
                                child: Slider(
                                  value:
                                      duration != null &&
                                          duration.inMilliseconds > 0
                                      ? position.inMilliseconds
                                            .clamp(0, duration.inMilliseconds)
                                            .toDouble()
                                      : 0,
                                  max: (duration?.inMilliseconds ?? 0)
                                      .toDouble()
                                      .clamp(1, double.infinity),
                                  onChanged: duration == null || _locked
                                      ? null
                                      : (value) => setState(() {}),
                                  onChangeEnd: duration == null || _locked
                                      ? null
                                      : (value) => _seekTo(value / 1000),
                                ),
                              ),
                            ),
                            Text(
                              duration != null
                                  ? _formatTime(duration)
                                  : '--:--',
                              style: const TextStyle(
                                color: Colors.white70,
                                fontSize: 11,
                              ),
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
                                  icon: const Icon(
                                    Icons.skip_previous,
                                    color: Colors.white,
                                  ),
                                  onPressed: video.previousFileId == null
                                      ? null
                                      : () => context.pushReplacement(
                                          '/watch/${video.previousFileId}',
                                        ),
                                ),
                                IconButton(
                                  icon: const Icon(
                                    Icons.replay_10,
                                    color: Colors.white,
                                  ),
                                  onPressed: _locked ? null : () => _skip(-_skipSeconds),
                                  tooltip: _locked ? "You don't have playback control in this watch party" : null,
                                ),
                                IconButton(
                                  icon: Icon(
                                    (_controller?.value.isPlaying ?? false)
                                        ? Icons.pause
                                        : Icons.play_arrow,
                                    color: Colors.white,
                                    size: 30,
                                  ),
                                  onPressed: _togglePlay,
                                ),
                                IconButton(
                                  icon: const Icon(
                                    Icons.forward_10,
                                    color: Colors.white,
                                  ),
                                  onPressed: _locked ? null : () => _skip(_skipSeconds),
                                  tooltip: _locked ? "You don't have playback control in this watch party" : null,
                                ),
                                IconButton(
                                  icon: const Icon(
                                    Icons.skip_next,
                                    color: Colors.white,
                                  ),
                                  onPressed: video.nextFileId == null
                                      ? null
                                      : () => context.pushReplacement(
                                          '/watch/${video.nextFileId}',
                                        ),
                                ),
                              ],
                            ),
                            Row(
                              children: [
                                TextButton(
                                  onPressed: _locked ? null : _cycleSpeed,
                                  child: Text(
                                    '${_speed}x',
                                    style: TextStyle(
                                      color: _locked ? Colors.white30 : Colors.white70,
                                      fontSize: 12,
                                    ),
                                  ),
                                ),
                                if (_ladderHeights.isNotEmpty)
                                  IconButton(
                                    icon: const Icon(
                                      Icons.hd_outlined,
                                      color: Colors.white,
                                      size: 20,
                                    ),
                                    onPressed: () => setState(() {
                                      _qualityMenuOpen = !_qualityMenuOpen;
                                      _subtitleMenuOpen = false;
                                      _audioMenuOpen = false;
                                      _episodesOpen = false;
                                      _hideTimer?.cancel();
                                      _controlsVisible = true;
                                    }),
                                  ),
                                if (video.isNative &&
                                    video.subtitles.isNotEmpty)
                                  IconButton(
                                    icon: const Icon(
                                      Icons.subtitles_outlined,
                                      color: Colors.white,
                                      size: 20,
                                    ),
                                    onPressed: () => setState(() {
                                      _subtitleMenuOpen = !_subtitleMenuOpen;
                                      _audioMenuOpen = false;
                                      _episodesOpen = false;
                                      _qualityMenuOpen = false;
                                      _hideTimer?.cancel();
                                      _controlsVisible = true;
                                    }),
                                  ),
                                if (!video.isNative &&
                                    (_probe?.audioTracks.length ?? 0) > 1)
                                  IconButton(
                                    icon: const Icon(
                                      Icons.audiotrack,
                                      color: Colors.white,
                                      size: 20,
                                    ),
                                    onPressed: () => setState(() {
                                      _audioMenuOpen = !_audioMenuOpen;
                                      _subtitleMenuOpen = false;
                                      _episodesOpen = false;
                                      _qualityMenuOpen = false;
                                      _hideTimer?.cancel();
                                      _controlsVisible = true;
                                    }),
                                  ),
                                if (video.episodes.isNotEmpty)
                                  IconButton(
                                    icon: const Icon(
                                      Icons.playlist_play,
                                      color: Colors.white,
                                      size: 22,
                                    ),
                                    onPressed: () => setState(() {
                                      _episodesOpen = !_episodesOpen;
                                      _subtitleMenuOpen = false;
                                      _audioMenuOpen = false;
                                      _qualityMenuOpen = false;
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
            if (_qualityMenuOpen) _qualityMenu(),
          ],
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
        child: Text(
          label,
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w600,
            fontSize: 13,
          ),
        ),
      ),
    );
  }

  Widget _sidePanel(String title, List<Widget> children) {
    return Positioned.fill(
      child: Row(
        children: [
          Expanded(
            child: GestureDetector(
              onTap: _closePanels,
              child: Container(color: Colors.black54),
            ),
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
                          child: Text(
                            title,
                            style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        IconButton(
                          icon: const Icon(Icons.close, color: Colors.white70),
                          onPressed: _closePanels,
                        ),
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

  Widget _qualityMenu() {
    final heights = _ladderHeights;
    final sourceHeight = _probe?.sourceHeight;
    return _sidePanel('Quality', [
      RadioListTile<String>(
        value: 'auto',
        groupValue: _qualitySelection,
        title: Text(
          _qualitySelection == 'auto' && _autoResolvedHeight != null
              ? 'Auto (${_autoResolvedHeight}p)'
              : 'Auto',
          style: const TextStyle(color: Colors.white70),
        ),
        activeColor: AppColors.accent,
        onChanged: (_) => _changeQuality('auto'),
      ),
      RadioListTile<String>(
        value: 'original',
        groupValue: _qualitySelection,
        title: Text(
          sourceHeight != null ? 'Original (${sourceHeight}p)' : 'Original',
          style: const TextStyle(color: Colors.white70),
        ),
        activeColor: AppColors.accent,
        onChanged: (_) => _changeQuality('original'),
      ),
      ...heights.map((h) {
        final option = _probe!.availableQualities.firstWhere((q) => q.height == h);
        return RadioListTile<String>(
          value: h.toString(),
          groupValue: _qualitySelection,
          title: Text(option.label, style: const TextStyle(color: Colors.white70)),
          activeColor: AppColors.accent,
          onChanged: (_) => _changeQuality(h.toString()),
        );
      }),
    ]);
  }

  Widget _subtitleMenu() {
    return _sidePanel('Subtitles', [
      RadioListTile<int?>(
        value: null,
        groupValue: _subtitleIndex,
        title: const Text('Off', style: TextStyle(color: Colors.white70)),
        activeColor: AppColors.accent,
        onChanged: (value) => setState(() {
          _subtitleIndex = value;
          _subtitlePreferenceSource = 'off';
          _subtitlePreferenceIndex = null;
          _saveProgress(force: true);
        }),
      ),
      ...video.subtitles.map((s) {
        final label = s.language ?? s.title ?? 'Track ${s.index}';
        return RadioListTile<int?>(
          value: s.index,
          groupValue: _subtitleIndex,
          title: Text(label, style: const TextStyle(color: Colors.white70)),
          activeColor: AppColors.accent,
          onChanged: (value) => setState(() {
            _subtitleIndex = value;
            _subtitlePreferenceSource = 'external';
            _subtitlePreferenceIndex = value;
            _saveProgress(force: true);
          }),
        );
      }),
    ]);
  }

  Widget _audioMenu() {
    final tracks = _probe?.audioTracks ?? [];
    return _sidePanel('Audio Track', [
      ...tracks.map((t) {
        final label =
            '${t.language ?? 'Track ${t.index}'} (${t.codecName.toUpperCase()})';
        return RadioListTile<int?>(
          value: t.index,
          groupValue: _audioIndex ?? tracks.first.index,
          title: Text(label, style: const TextStyle(color: Colors.white70)),
          activeColor: AppColors.accent,
          onChanged: (value) {
            _closePanels();
            if (value != null) {
              _hasAudioPreference = true;
              _audioPreferenceLanguage = t.language;
              _audioPreferenceTitle = t.title;
              _reload(
                seekTo: _absolutePosition.inSeconds.toDouble(),
                audioIndex: value,
              );
              _saveProgress(force: true);
            }
          },
        );
      }),
    ]);
  }
}
