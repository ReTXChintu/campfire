import 'dart:async';
import 'dart:io' show Platform;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:media_kit/media_kit.dart';
import 'package:media_kit_video/media_kit_video.dart';
import 'package:screen_brightness/screen_brightness.dart';
import 'package:volume_controller/volume_controller.dart';
import 'package:window_manager/window_manager.dart';
import '../config.dart';
import '../models/catalog.dart';
import '../models/watch_party.dart';
import '../platform_info.dart';
import '../services/catalog_service.dart';
import '../services/media_session_service.dart';
import '../services/media_token_service.dart';
import '../services/pip_service.dart';
import '../services/quality_prefs_service.dart';
import '../services/watch_party_sync_controller.dart';
import '../theme/app_theme.dart';
import 'episodes_panel.dart';
import 'lock_banner.dart';

// TEMP diagnostic logging — remove once the Android resume/subtitle investigation is done.
void _dbg(String msg) => debugPrint('[MKV ${DateTime.now().toIso8601String().substring(11, 23)}] $msg');

const _speedOptions = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
const _hideControlsDelay = Duration(seconds: 3);
const _saveInterval = Duration(seconds: 10);
const _skipSeconds = 10;

// Auto-mode quality heuristic — same constants and shape as the web player's (kept in sync by
// hand, no shared code across TS/Dart): react to buffering events, not real throughput/segment
// measurement. Deliberately MVP-realistic, not broadcast-grade ABR — see QualitySection.tsx/
// VideoPlayer.tsx on web for the full rationale.
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
  // Set by WatchScreen only while a watch party is active for this video — see
  // watch_party_sync_controller.dart. Null means "no party", exactly like today.
  final WatchPartySyncController? watchPartySync;

  const MediaKitVideoPlayer({super.key, required this.video, this.watchPartySync});

  @override
  State<MediaKitVideoPlayer> createState() => _MediaKitVideoPlayerState();
}

class _MediaKitVideoPlayerState extends State<MediaKitVideoPlayer> with WidgetsBindingObserver {
  // libass off (the package default) means mpv's own subtitle renderer never runs — fine for
  // text-based tracks (SRT/ASS/SSA/mov_text/WebVTT, which media_kit renders via a Flutter-side
  // text overlay instead) but silently blind to image-based ones (DVD/PGS subtitles, common in
  // rips from this era) since those need mpv to actually blit a bitmap onto the frame; there's no
  // text for the Flutter overlay to show. Windows needs no bundled font (fontconfig handles
  // fallback); Android can't pick up system fonts for libass at all, so it needs an explicit
  // bundled .ttf (assets/fonts/NotoSans-Regular.ttf, SIL OFL-licensed) plus the font's actual
  // family name for mpv's `sub-font` option to reference.
  late final Player _player = Player(
    configuration: Platform.isAndroid
        ? const PlayerConfiguration(
            libass: true,
            libassAndroidFont: 'assets/fonts/NotoSans-Regular.ttf',
            libassAndroidFontName: 'Noto Sans',
          )
        : PlayerConfiguration(libass: Platform.isWindows),
  );
  late final VideoController _controller = VideoController(_player);
  final List<StreamSubscription> _subs = [];

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
  // Live drag position on the seek bar — tracked separately from the controller's own playback
  // position so the thumb (and the floating timestamp tooltip) follow the drag instead of snapping
  // back to wherever real playback currently is; committed via _seekTo only once the user releases.
  double? _scrubSeconds;
  // See _navigateToEpisode.
  bool _skipOrientationRestoreOnDispose = false;

  // Windows only — toggles the OS window itself (there's no in-player "fullscreen" concept on
  // desktop the way the web <video> element has one). Never true/used on any other platform.
  bool _isFullscreen = false;

  Future<void> _toggleFullscreen() async {
    if (!Platform.isWindows) return;
    final next = !_isFullscreen;
    await windowManager.setFullScreen(next);
    if (mounted) setState(() => _isFullscreen = next);
  }

  // True while opening/seeking to a resume position (mount, or a quality-change reopen) is still
  // in flight. media_kit's position stream starts emitting ticks as soon as a Media is opened —
  // well before the compensating seek below actually lands — so without this guard, an early tick
  // reporting ~0 could get saved and clobber a correct previously-saved progress value. Saves are
  // suppressed (not deferred) while this is false; the next real tick after the seek lands reports
  // the true position and resumes saving normally.
  bool _resumeSeekComplete = true;
  String? _mediaToken;
  String? _errorMessage;
  Offset? _doubleTapLocalPosition;

  // Completes on the first `position` stream tick after the *current* open/reopen — distinct from
  // `_resumeSeekComplete` (which flips true as soon as the open()/setSubtitleTrack() await chain
  // finishes, well before the position stream has actually caught up to a `start:`-seeded resume
  // on a slow connection: confirmed live on Android, several seconds behind). Anything that reopens
  // the stream automatically (not from a direct user action — currently only
  // _maybeSeedAutoQuality's remembered-ceiling seed) must wait on this before capturing "the
  // current position to preserve", or it captures a stale ~0 and the reopen silently resets
  // playback to the start right after a correct resume just landed.
  Completer<void> _firstPositionTickCompleter = Completer<void>();
  bool _sawFirstPositionTick = false;

  // Watch Party sync — see watch_party_sync_controller.dart. Set true for the duration of
  // _applyInboundSyncState so the seek/play/pause calls it makes don't get re-broadcast as if they
  // were a local user action (mirrors VideoPlayer.tsx's applyingInboundSyncRef).
  bool _applyingInboundSync = false;

  // Sync only ever applies to native-mode content (matches web's seekMode === "native" gate) — MKV
  // ("raw") and "restart" mode content never sync, same as web.
  bool get _syncEnabled => video.isNative && widget.watchPartySync != null;
  // Anyone without playback control can't seek/skip/change speed during a synced party — those
  // actions would silently desync them until the controller's next broadcast, with no indication
  // anything "failed". Doesn't lock play/pause — pausing locally is harmless, it just won't stick
  // once the next inbound sync arrives.
  bool get _locked => _syncEnabled && !(widget.watchPartySync?.canControl ?? false);

  // Android brightness/volume swipe gestures — see campfire_video_player.dart's identical fields
  // for the full rationale (app-window-only brightness, system volume with the OS's own HUD).
  bool? _dragIsLeftSide;
  double _dragAccumulatedDy = 0;
  double? _dragStartBrightness;
  double? _dragStartVolume;
  double? _brightnessOverlay; // 0.0-1.0, null = hidden
  Timer? _overlayHideTimer;

  // PiP auto-enter — see services/pip_service.dart. Tracks whichever playing value was last told
  // to native, so the playing-stream listener only calls the platform channel on an actual
  // transition, not every emission.
  bool _lastPipEligible = false;

  Duration _position = Duration.zero;
  Duration _duration = Duration.zero;
  bool _playing = false;
  Tracks _tracks = const Tracks();
  Track _track = const Track();
  ProbeResult? _probe; // now fetched for every video — see _bootstrap — not just restart mode.

  // The user's actual subtitle choice, independent of the player-internal `_track.subtitle` state
  // that `_player.open()` resets on every reopen (quality change, auto-quality step, any restart-
  // mode skip/seek). Re-applied after every reopen in `_reopenAt` — without this, picking a
  // subtitle track "worked" only until the next reopen (which can happen automatically, seconds
  // later, via Auto-quality's remembered-ceiling seed) silently reset it back to none. A
  // SubtitleTrack.data(...) selection (the common case here — see video.subtitles) carries its own
  // VTT text and reapplies correctly on any file; an embedded-track id only carries over if the
  // newly-opened file happens to have a matching track (harmless no-op otherwise, same as before).
  SubtitleTrack _selectedSubtitleTrack = SubtitleTrack.no();

  // Remembered-preference state, saved to the backend on every progress save (see
  // apps/backend/src/lib/progress.ts) and reapplied on future opens of this video. Subtitle is
  // only tracked when it maps to a `video.subtitles` entry — an embedded-track pick (see
  // _selectedSubtitleTrack's own comment) has no portable identifier worth persisting, so picking
  // one just leaves these fields (and thus the saved preference) unchanged. Audio is matched by
  // language+title rather than mpv's own track id, which isn't stable/portable across opens.
  String? _subtitlePreferenceSource; // "off" | "external" | null (nothing to save yet)
  int? _subtitlePreferenceIndex;
  String? _audioPreferenceLanguage;
  String? _audioPreferenceTitle;
  bool _hasAudioPreference = false; // distinguishes "no preference" from "prefers null/null"

  // "auto" | "original" | "<height>" — mirrors QualitySelection on web (Dart has no union types).
  String _qualitySelection = 'auto';
  int? _autoResolvedHeight;
  DateTime? _autoStallStart;
  final List<DateTime> _autoBufferEvents = [];
  DateTime _autoLastChange = DateTime.fromMillisecondsSinceEpoch(0);
  DateTime _autoStableSince = DateTime.now();
  Timer? _autoStepUpTimer;

  VideoResponse get video => widget.video;

  int? get _effectiveHeight {
    if (_qualitySelection == 'auto') return _autoResolvedHeight;
    if (_qualitySelection == 'original') return null;
    return int.tryParse(_qualitySelection);
  }

  List<int> get _ladderHeights => (_probe?.availableQualities ?? const []).map((q) => q.height).toList();

  // True only for real Range-seekable byte passthrough — native/raw content at its own source
  // resolution.
  bool get _usingPassthrough => (video.isNative || video.isRaw) && _effectiveHeight == null;

  // True for passthrough OR any specific quality tier — every tier the quality menu offers is a
  // pre-generated file with real Range support of its own (see lib/renditions.ts on the backend),
  // not a live re-encode, so it's just as directly seekable as passthrough. Only true restart mode
  // (a non-native/non-raw format at Original, no rendition involved — the live ffmpeg remux) has
  // no real seeking and needs the reload-at-`t=` trick instead.
  bool get _streamIsSeekable => _usingPassthrough || _effectiveHeight != null;

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
    // TV starts in "Watching" mode — chrome hidden, nothing focused, any D-pad press wakes it (see
    // design.html's two-mode focus model, handled in the Focus/PopScope wrapper in build()).
    // Everywhere else the chrome is visible from the start, as before.
    if (isAndroidTv) _controlsVisible = false;

    // Seed remembered track preferences from the last time this video was watched (by this user,
    // any player/platform — see apps/backend/src/lib/progress.ts). Subtitle is applied directly
    // below since it only needs `video.subtitles` (already in hand); audio needs `_tracks.audio`,
    // which only exists once the player has actually opened something, so that match happens in
    // the tracks listener instead (see _maybeApplyAudioPreference).
    _subtitlePreferenceSource = video.initialSubtitleSource == 'off' || video.initialSubtitleSource == 'external'
        ? video.initialSubtitleSource
        : null;
    _subtitlePreferenceIndex = video.initialSubtitleIndex;
    if (video.initialAudioLanguage != null || video.initialAudioTitle != null) {
      _hasAudioPreference = true;
      _audioPreferenceLanguage = video.initialAudioLanguage;
      _audioPreferenceTitle = video.initialAudioTitle;
    }
    if (_subtitlePreferenceSource == 'external' &&
        _subtitlePreferenceIndex != null &&
        _subtitlePreferenceIndex! >= 0 &&
        _subtitlePreferenceIndex! < video.subtitles.length) {
      final s = video.subtitles[_subtitlePreferenceIndex!];
      _selectedSubtitleTrack = SubtitleTrack.data(s.vtt, title: s.title, language: s.language);
    }

    _subs.addAll([
      _player.stream.position.listen((p) {
        if (!mounted) return;
        if ((p - _position).abs() > const Duration(seconds: 2)) {
          _dbg('position JUMP: $_position -> $p (resumeSeekComplete=$_resumeSeekComplete)');
        }
        if (!_sawFirstPositionTick) {
          _sawFirstPositionTick = true;
          if (!_firstPositionTickCompleter.isCompleted) _firstPositionTickCompleter.complete();
        }
        setState(() => _position = p);
        _maybeSave();
        _maybeAutoAdvance();
        MediaSessionService.updateState(playing: _playing, position: p, speed: _speed);
      }),
      _player.stream.duration.listen((d) {
        if (_duration == Duration.zero && d > Duration.zero) {
          _dbg('duration first ready: $d (at position=${_player.state.position})');
        }
        if (mounted) setState(() => _duration = d);
      }),
      _player.stream.playing.listen((p) {
        if (mounted) setState(() => _playing = p);
        MediaSessionService.updateState(playing: p, position: _position, speed: _speed);
        if (p != _lastPipEligible) {
          _lastPipEligible = p;
          PipService.setAutoEnterEnabled(p);
        }
      }),
      _player.stream.buffering.listen((b) {
        if (!mounted) return;
        _dbg('buffering=$b position=${_player.state.position}');
        setState(() => _isBuffering = b);
        if (_qualitySelection == 'auto') {
          if (b) {
            _onAutoBufferingStart();
          } else {
            _onAutoBufferingRecovered();
          }
        }
      }),
      _player.stream.tracks.listen((t) {
        if (!mounted) return;
        _dbg('tracks updated: subtitle=${t.subtitle.map((s) => '${s.id}:${s.title ?? s.language ?? "?"}').toList()}');
        setState(() => _tracks = t);
        _maybeApplyAudioPreference();
      }),
      _player.stream.track.listen((t) {
        _dbg('active track changed: subtitle.id=${t.subtitle.id} title=${t.subtitle.title}');
        if (mounted) setState(() => _track = t);
      }),
      _player.stream.completed.listen((completed) {
        if (completed) _goToNext();
      }),
      // Without this, a failed open (bad URL, network error, unsupported codec, ...) just leaves
      // the buffering spinner spinning forever with nothing in the UI explaining why.
      _player.stream.error.listen((message) {
        _dbg('player ERROR: $message');
        if (mounted) setState(() => _errorMessage = message);
      }),
    ]);
    _autoStepUpTimer = Timer.periodic(_autoWindow, (_) {
      if (mounted && _qualitySelection == 'auto' && _playing) _autoStepUp();
    });
    _bootstrap();
    _scheduleHide();
    widget.watchPartySync?.addListener(_onSyncControllerChanged);

    // Android only (no-op elsewhere — MediaSessionService's handler is null on every other
    // platform). onPlay/onPause reuse _togglePlay(), calling it only when the direction actually
    // matches so a Bluetooth press can't double-toggle.
    MediaSessionService.attach(
      title: video.title,
      duration: video.durationSeconds != null ? Duration(milliseconds: (video.durationSeconds! * 1000).round()) : null,
      onPlay: () {
        if (!_playing) _togglePlay();
      },
      onPause: () {
        if (_playing) _togglePlay();
      },
      onSeek: (position) => _seekTo(position.inMilliseconds / 1000),
      onSkipNext: video.nextFileId == null ? null : _goToNext,
      onSkipPrevious: video.previousFileId == null
          ? null
          : () => _navigateToEpisode(video.previousFileId!),
    );
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
    final updatedAt = DateTime.tryParse(state.updatedAt) ?? DateTime.now();
    final elapsedSeconds = DateTime.now().difference(updatedAt).inMilliseconds / 1000;
    final targetSeconds = (state.positionSeconds + (state.playing ? elapsedSeconds * state.playbackRate : 0))
        .clamp(0, double.infinity)
        .toDouble();

    _applyingInboundSync = true;
    if (_speed != state.playbackRate) {
      setState(() => _speed = state.playbackRate);
      _player.setRate(state.playbackRate);
    }
    _seekTo(targetSeconds);
    if (state.playing) {
      _player.play();
    } else {
      _player.pause();
    }
    // Cleared on the next microtask rather than immediately — _seekTo/_player.play() above may
    // themselves be asynchronous (a restart-mode _reopenAt), and the guard needs to still be up for
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
        playing: _playing,
        positionSeconds: positionSecondsOverride ?? (_position.inMilliseconds / 1000),
        playbackRate: _speed,
        updatedAt: DateTime.now().toIso8601String(),
      ),
    );
  }

  Uri _streamUri({double restartOffsetSeconds = 0}) {
    final params = <String, String>{
      if (_mediaToken != null) 'token': _mediaToken!,
    };
    final height = _effectiveHeight;
    if (height != null) params['h'] = height.toString();
    if (video.isRaw && _usingPassthrough) {
      // Opts into the true byte-passthrough path for MKV (see routes/stream.ts) — without it the
      // backend defaults to the ffmpeg-remux "restart" behavior every other client gets. Only
      // applies at Original quality — a genuine downscale always needs decoding regardless of
      // container, so it can't stay on the raw byte-passthrough path.
      params['raw'] = '1';
    } else if (!_streamIsSeekable && restartOffsetSeconds > 0) {
      params['t'] = restartOffsetSeconds.floor().toString();
    }
    final base = '$apiBaseUrl/api/stream/${video.fileId}';
    return params.isEmpty ? Uri.parse(base) : Uri.parse(base).replace(queryParameters: params);
  }

  Future<void> _bootstrap() async {
    // Probed for every video now (not just restart mode) — the quality menu needs
    // sourceHeight/availableQualities regardless of seekMode. Fire-and-forget so it never delays
    // playback start; the quality menu (and Auto's initial seed, below) just populate a beat later.
    CatalogService.fetchProbe(video.fileId).then((p) {
      if (!mounted) return;
      setState(() => _probe = p);
      _maybeSeedAutoQuality(p);
    }).catchError((_) {});

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
    final needsResumeSeek = resumeSeconds > 0 && _streamIsSeekable;
    _dbg(
      'bootstrap: initialPositionSeconds=${video.initialPositionSeconds} completed=${video.initialCompleted} '
      'resumeSeconds=$resumeSeconds needsResumeSeek=$needsResumeSeek streamIsSeekable=$_streamIsSeekable '
      'isRaw=${video.isRaw} usingPassthrough=$_usingPassthrough uri=${_streamUri(restartOffsetSeconds: resumeSeconds)}',
    );
    // Media's `start:` tells mpv to begin playback already at this offset, instead of opening at 0
    // and correcting with a seek() afterward — Player.open() defaults to play:true, so a manual
    // post-open seek races already-started playback (loses that race often enough on a slow
    // connection, exactly the case that matters most for MKVs streamed live from Drive) rather than
    // reliably landing before the viewer notices. `start:` avoids the race entirely.
    if (needsResumeSeek) _resumeSeekComplete = false;
    _firstPositionTickCompleter = Completer<void>();
    _sawFirstPositionTick = false;
    await _player.open(
      Media(
        _streamUri(restartOffsetSeconds: resumeSeconds).toString(),
        start: needsResumeSeek ? Duration(milliseconds: (resumeSeconds * 1000).round()) : null,
      ),
    );
    _dbg('bootstrap: open() returned, player.state.position=${_player.state.position} duration=${_player.state.duration}');
    await _player.setRate(_speed);
    // Defaults to SubtitleTrack.no() (see _selectedSubtitleTrack's initializer) rather than
    // libmpv's own default-flag-driven auto-selection — matching the native-mode player's default
    // of no track pre-selected.
    await _player.setSubtitleTrack(_selectedSubtitleTrack);
    _resumeSeekComplete = true;
    _dbg('bootstrap: done, resumeSeekComplete=true, player.state.position=${_player.state.position}');
  }

  // Seeds Auto's starting tier from this device's last learned ceiling once probe resolves (so a
  // known-weak device doesn't have to rediscover its ceiling via a rough patch on every video) —
  // clamped to this video's own ladder. Only applies if nothing has already resolved Auto's height
  // (a buffering event firing before probe even returns is vanishingly unlikely, but don't clobber
  // it if it somehow did).
  void _maybeSeedAutoQuality(ProbeResult probe) async {
    if (_qualitySelection != 'auto' || _autoResolvedHeight != null) return;
    final heights = probe.availableQualities.map((q) => q.height).toList();
    final remembered = await QualityPrefsService.getCeiling();
    // Never reopen (which captures "the current position" via _applyAutoChange/_reopenAt) before
    // the initial resume-seeded open has actually landed a real position tick — probe resolving
    // (which triggers this) races the bootstrap open independently, and on a slow connection can
    // easily finish first, capturing a stale ~0 and silently resetting a correct resume back to
    // the start seconds after it landed. Confirmed live on Android.
    _dbg('maybeSeedAutoQuality: remembered=$remembered heights=$heights waiting for first position tick...');
    await _firstPositionTickCompleter.future;
    _dbg('maybeSeedAutoQuality: first tick landed, position=$_position — proceeding');
    if (!mounted || _qualitySelection != 'auto' || _autoResolvedHeight != null) return;
    if (remembered != null && heights.contains(remembered)) {
      _applyAutoChange(remembered);
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _hideTimer?.cancel();
    _autoStepUpTimer?.cancel();
    _overlayHideTimer?.cancel();
    for (final sub in _subs) {
      sub.cancel();
    }
    _saveProgress(force: true);
    if (!_skipOrientationRestoreOnDispose) _restoreSystemChrome();
    // Release anything still awaiting the first tick (e.g. _maybeSeedAutoQuality) rather than
    // leaving it dangling forever on a video that never got a chance to play.
    if (!_firstPositionTickCompleter.isCompleted) _firstPositionTickCompleter.complete();
    _player.dispose();
    widget.watchPartySync?.removeListener(_onSyncControllerChanged);
    // Navigating back to the library should never leave the OS window stuck fullscreen.
    if (_isFullscreen) windowManager.setFullScreen(false);
    MediaSessionService.detach();
    PipService.setAutoEnterEnabled(false);
    if (Platform.isAndroid) ScreenBrightness().resetApplicationScreenBrightness().catchError((_) {});
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
    // Never save while a resume/quality-change seek is still in flight — _position briefly reports
    // wherever the newly-opened stream started (usually ~0), not the real position, and saving it
    // would silently overwrite correct previously-saved progress. Better to skip this save entirely
    // than clobber good data; the next tick after the seek lands saves the true position instead.
    if (!_resumeSeekComplete) return;
    final now = DateTime.now();
    if (!force && now.difference(_lastSave) < const Duration(seconds: 2)) return;
    _lastSave = now;
    CatalogService.saveProgress(
      fileId: video.fileId,
      parentFolderId: video.parentFolderId,
      positionSeconds: _position.inMilliseconds / 1000,
      durationSeconds: _effectiveDuration.inMilliseconds / 1000,
      subtitleSource: _subtitlePreferenceSource,
      subtitleIndex: _subtitlePreferenceSource == null ? unsetProgressField : _subtitlePreferenceIndex,
      audioLanguage: _hasAudioPreference ? _audioPreferenceLanguage : unsetProgressField,
      audioTitle: _hasAudioPreference ? _audioPreferenceTitle : unsetProgressField,
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
    final next = video.nextFileId;
    if (next != null) _navigateToEpisode(next);
  }

  // Every in-player way of switching to another episode (next/previous buttons, media-session
  // skip, the episodes panel) routes through here — always saves progress first, and skips this
  // player's own dispose-time _restoreSystemChrome() since the destination is also a video player
  // that locks landscape immediately in its own initState. Without that skip, dispose() (which
  // fires *after* the new player's initState — it stays mounted through the route-replace
  // transition) would relock portrait right after the new screen already locked landscape, leaving
  // the app stuck in portrait until manually rotated. See CampfireVideoPlayer's identical fix.
  void _navigateToEpisode(String fileId) {
    _saveProgress(force: true);
    _skipOrientationRestoreOnDispose = true;
    context.pushReplacement('/watch/$fileId');
  }

  void _scheduleHide() {
    _hideTimer?.cancel();
    _hideTimer = Timer(_hideControlsDelay, () {
      if (mounted &&
          _playing &&
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
    if (_playing) {
      _player.pause();
      _saveProgress(force: true);
    } else {
      _player.play();
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

  Future<void> _reopenAt(double seconds) async {
    setState(() => _isBuffering = true);
    final needsSeek = seconds > 0 && _streamIsSeekable;
    // See _bootstrap's identical comment: Media's `start:` tells mpv to begin already at this
    // offset, avoiding the race a post-open seek() has against Player.open()'s default play:true.
    if (needsSeek) _resumeSeekComplete = false;
    _firstPositionTickCompleter = Completer<void>();
    _sawFirstPositionTick = false;
    await _player.open(
      Media(
        _streamUri(restartOffsetSeconds: seconds).toString(),
        start: needsSeek ? Duration(milliseconds: (seconds * 1000).round()) : null,
      ),
    );
    await _player.setRate(_speed);
    // Reopening resets mpv's own subtitle selection — re-apply whatever the user actually picked
    // (see _selectedSubtitleTrack) rather than silently dropping back to none.
    await _player.setSubtitleTrack(_selectedSubtitleTrack);
    _resumeSeekComplete = true;
  }

  static const _dragFullRangePixels = 250.0; // full vertical drag distance for a 0.0 -> 1.0 sweep

  void _handleVerticalDragStart(DragStartDetails details) {
    final width = MediaQuery.sizeOf(context).width;
    _dragIsLeftSide = details.localPosition.dx < width / 2;
    _dragAccumulatedDy = 0;
    _dragStartBrightness = null;
    _dragStartVolume = null;
    if (_dragIsLeftSide == true) {
      ScreenBrightness().application.then((value) {
        if (mounted) _dragStartBrightness = value;
      }).catchError((_) {});
    } else {
      VolumeController.instance.getVolume().then((value) {
        if (mounted) _dragStartVolume = value;
      }).catchError((_) {});
    }
  }

  void _handleVerticalDragUpdate(DragUpdateDetails details) {
    _dragAccumulatedDy += details.delta.dy;
    final fraction = (-_dragAccumulatedDy / _dragFullRangePixels).clamp(-1.0, 1.0);
    if (_dragIsLeftSide == true) {
      final start = _dragStartBrightness;
      if (start == null) return; // still waiting on the initial value fetch — drop this update
      final next = (start + fraction).clamp(0.0, 1.0);
      ScreenBrightness().setApplicationScreenBrightness(next).catchError((_) {});
      setState(() => _brightnessOverlay = next);
      _scheduleHideOverlay();
    } else if (_dragIsLeftSide == false) {
      final start = _dragStartVolume;
      if (start == null) return;
      final next = (start + fraction).clamp(0.0, 1.0);
      VolumeController.instance.setVolume(next);
    }
  }

  void _handleVerticalDragEnd(DragEndDetails details) {
    _dragIsLeftSide = null;
    _scheduleHideOverlay();
  }

  void _scheduleHideOverlay() {
    _overlayHideTimer?.cancel();
    _overlayHideTimer = Timer(const Duration(milliseconds: 900), () {
      if (mounted) setState(() => _brightnessOverlay = null);
    });
  }

  void _skip(int deltaSeconds) {
    double targetSeconds;
    if (_streamIsSeekable) {
      var target = _position + Duration(seconds: deltaSeconds);
      if (target < Duration.zero) target = Duration.zero;
      final duration = _effectiveDuration;
      if (duration > Duration.zero && target > duration) target = duration;
      _player.seek(target);
      targetSeconds = target.inMilliseconds / 1000;
    } else {
      final target = (_position.inSeconds + deltaSeconds).clamp(0, 1 << 30).toDouble();
      _reopenAt(target);
      targetSeconds = target;
    }
    _showControls();
    _maybeBroadcastPartyState(positionSecondsOverride: targetSeconds);
  }

  void _seekTo(double seconds) {
    if (_streamIsSeekable) {
      _player.seek(Duration(milliseconds: (seconds * 1000).round()));
    } else {
      _reopenAt(seconds);
    }
    _maybeBroadcastPartyState(positionSecondsOverride: seconds);
  }

  void _changeQuality(String value) {
    final position = _position.inMilliseconds / 1000;
    setState(() => _qualitySelection = value);
    _reopenAt(position);
  }

  // Auto-mode's own quality changes reuse the exact same reopen mechanics as a manual pick above —
  // the only difference is who decided the target height.
  void _applyAutoChange(int? newHeight) {
    if (newHeight == _autoResolvedHeight) return;
    final position = _position.inMilliseconds / 1000;
    setState(() => _autoResolvedHeight = newHeight);
    QualityPrefsService.setCeiling(newHeight);
    _reopenAt(position);
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

  void _onAutoBufferingStart() {
    final now = DateTime.now();
    _autoStallStart = now;
    _autoBufferEvents.add(now);
    _autoBufferEvents.removeWhere((t) => now.difference(t) > _autoWindow);
  }

  void _onAutoBufferingRecovered() {
    final stallStart = _autoStallStart;
    _autoStallStart = null;
    if (stallStart != null && DateTime.now().difference(stallStart) >= _autoStallDuration) {
      _autoStepDown();
    } else if (_autoBufferEvents.length >= _autoStepDownEventCount) {
      _autoStepDown();
    }
  }

  void _cycleSpeed() {
    final idx = _speedOptions.indexOf(_speed);
    final next = _speedOptions[(idx + 1) % _speedOptions.length];
    setState(() => _speed = next);
    _player.setRate(next);
    _maybeBroadcastPartyState();
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
      _qualityMenuOpen = false;
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

    // Two-mode TV focus model (see design.html): Watching (chrome hidden, any D-pad key just wakes
    // it rather than also performing that key's normal action) vs Controlling (chrome visible,
    // Back walks back down to Watching instead of exiting the player outright — canPop only allows
    // the real pop once already in Watching). No-op everywhere else (canPop stays true, key
    // handling unchanged).
    return PopScope(
      canPop: !isAndroidTv || !_controlsVisible,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop && isAndroidTv && _controlsVisible) setState(() => _controlsVisible = false);
      },
      child: Focus(
      focusNode: widget.watchPartySync?.tvChromeFocusNode,
      autofocus: true,
      onKeyEvent: (node, event) {
        if (event is! KeyDownEvent) return KeyEventResult.ignored;
        if (isAndroidTv && !_controlsVisible) {
          _showControls();
          return KeyEventResult.handled;
        }
        if (event.logicalKey == LogicalKeyboardKey.space) {
          _togglePlay();
          return KeyEventResult.handled;
        }
        if (event.logicalKey == LogicalKeyboardKey.escape && _isFullscreen) {
          _toggleFullscreen();
          return KeyEventResult.handled;
        }
        return KeyEventResult.ignored;
      },
      child: GestureDetector(
      onTap: _showControls,
      onDoubleTapDown: (details) => _doubleTapLocalPosition = details.localPosition,
      onDoubleTap: _handleDoubleTap,
      onVerticalDragStart: Platform.isAndroid ? _handleVerticalDragStart : null,
      onVerticalDragUpdate: Platform.isAndroid ? _handleVerticalDragUpdate : null,
      onVerticalDragEnd: Platform.isAndroid ? _handleVerticalDragEnd : null,
      child: ColoredBox(
        color: Colors.black,
        child: Stack(
          fit: StackFit.expand,
          children: [
            Video(controller: _controller, controls: NoVideoControls, fit: BoxFit.contain),

            if (_isBuffering) const Center(child: CircularProgressIndicator(color: Colors.white70)),

            if (_locked) const Positioned(left: 16, right: 16, top: 64, child: LockBanner()),

            // Only brightness gets a custom HUD — the volume gesture leaves showSystemUI on for
            // VolumeController.setVolume, so the OS's own volume overlay already shows for that one.
            if (_brightnessOverlay != null)
              Center(child: _gestureHud(Icons.brightness_6, _brightnessOverlay!)),

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
                              child: LayoutBuilder(
                                builder: (context, constraints) {
                                  final maxMs = duration.inMilliseconds.toDouble().clamp(1, double.infinity).toDouble();
                                  final sliderValue = duration.inMilliseconds > 0
                                      ? (_scrubSeconds != null
                                                ? _scrubSeconds! * 1000
                                                : position.inMilliseconds.toDouble())
                                            .clamp(0, duration.inMilliseconds.toDouble())
                                            .toDouble()
                                      : 0.0;
                                  final fraction = sliderValue / maxMs;
                                  return Stack(
                                    clipBehavior: Clip.none,
                                    children: [
                                      if (_scrubSeconds != null)
                                        Positioned(
                                          left: (fraction * constraints.maxWidth - 20)
                                              .clamp(0.0, (constraints.maxWidth - 40).clamp(0.0, double.infinity))
                                              .toDouble(),
                                          bottom: 28,
                                          child: Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                            decoration: BoxDecoration(
                                              color: Colors.black.withValues(alpha: 0.9),
                                              borderRadius: BorderRadius.circular(6),
                                            ),
                                            child: Text(
                                              _formatTime(Duration(milliseconds: sliderValue.round())),
                                              style: const TextStyle(
                                                color: Colors.white,
                                                fontSize: 11,
                                                fontWeight: FontWeight.w600,
                                              ),
                                            ),
                                          ),
                                        ),
                                      SliderTheme(
                                        data: SliderTheme.of(context).copyWith(
                                          trackHeight: 2,
                                          thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 6),
                                          overlayShape: const RoundSliderOverlayShape(overlayRadius: 12),
                                          activeTrackColor: Colors.white,
                                          inactiveTrackColor: Colors.white24,
                                          thumbColor: Colors.white,
                                        ),
                                        child: Slider(
                                          value: sliderValue,
                                          max: maxMs,
                                          // Cancel the auto-hide timer for the whole drag, not just
                                          // on tap — otherwise a drag that outlasts
                                          // _hideControlsDelay hides the bar (and this slider) out
                                          // from under the user's thumb mid-scrub.
                                          onChangeStart: duration.inMilliseconds <= 0 || _locked
                                              ? null
                                              : (value) {
                                                  _hideTimer?.cancel();
                                                  setState(() => _scrubSeconds = value / 1000);
                                                },
                                          onChanged: duration.inMilliseconds <= 0 || _locked
                                              ? null
                                              : (value) => setState(() => _scrubSeconds = value / 1000),
                                          onChangeEnd: duration.inMilliseconds <= 0 || _locked
                                              ? null
                                              : (value) {
                                                  _seekTo(value / 1000);
                                                  setState(() => _scrubSeconds = null);
                                                  _showControls();
                                                },
                                        ),
                                      ),
                                    ],
                                  );
                                },
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
                                      : () => _navigateToEpisode(video.previousFileId!),
                                ),
                                IconButton(
                                  icon: const Icon(Icons.replay_10, color: Colors.white),
                                  onPressed: _locked ? null : () => _skip(-_skipSeconds),
                                  tooltip: _locked ? "You don't have playback control in this watch party" : null,
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
                                  onPressed: _locked ? null : () => _skip(_skipSeconds),
                                  tooltip: _locked ? "You don't have playback control in this watch party" : null,
                                ),
                                IconButton(
                                  icon: const Icon(Icons.skip_next, color: Colors.white),
                                  onPressed: video.nextFileId == null ? null : _goToNext,
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
                                    icon: const Icon(Icons.hd_outlined, color: Colors.white, size: 20),
                                    onPressed: () => setState(() {
                                      _qualityMenuOpen = !_qualityMenuOpen;
                                      _subtitleMenuOpen = false;
                                      _audioMenuOpen = false;
                                      _episodesOpen = false;
                                      _hideTimer?.cancel();
                                      _controlsVisible = true;
                                    }),
                                  ),
                                if (hasSubtitles)
                                  IconButton(
                                    icon: const Icon(Icons.subtitles_outlined, color: Colors.white, size: 20),
                                    onPressed: () => setState(() {
                                      _subtitleMenuOpen = !_subtitleMenuOpen;
                                      _audioMenuOpen = false;
                                      _episodesOpen = false;
                                      _qualityMenuOpen = false;
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
                                      _qualityMenuOpen = false;
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
                                      _qualityMenuOpen = false;
                                      _hideTimer?.cancel();
                                      _controlsVisible = true;
                                    }),
                                  ),
                                if (Platform.isAndroid)
                                  IconButton(
                                    icon: const Icon(
                                      Icons.picture_in_picture_alt,
                                      color: Colors.white,
                                      size: 20,
                                    ),
                                    tooltip: 'Picture in picture',
                                    onPressed: PipService.enterNow,
                                  ),
                                if (Platform.isWindows)
                                  IconButton(
                                    icon: Icon(
                                      _isFullscreen ? Icons.fullscreen_exit : Icons.fullscreen,
                                      color: Colors.white,
                                      size: 22,
                                    ),
                                    tooltip: _isFullscreen ? 'Exit fullscreen' : 'Fullscreen',
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
                onSelect: _navigateToEpisode,
                onClose: _closePanels,
              ),

            if (_subtitleMenuOpen) _subtitleMenu(),
            if (_audioMenuOpen) _audioMenu(),
            if (_qualityMenuOpen) _qualityMenu(),
          ],
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

  Widget _gestureHud(IconData icon, double value) {
    return Container(
      width: 120,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.75),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: Colors.white, size: 22),
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(2),
            child: LinearProgressIndicator(
              value: value,
              minHeight: 4,
              backgroundColor: Colors.white24,
              valueColor: const AlwaysStoppedAnimation(Colors.white),
            ),
          ),
        ],
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
          _selectedSubtitleTrack = SubtitleTrack.no();
          _player.setSubtitleTrack(_selectedSubtitleTrack);
          _subtitlePreferenceSource = 'off';
          _subtitlePreferenceIndex = null;
          _saveProgress(force: true);
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
            _selectedSubtitleTrack = entry.track;
            _player.setSubtitleTrack(_selectedSubtitleTrack);
            _subtitlePreferenceSource = 'external';
            _subtitlePreferenceIndex = entry.subtitle.index;
            _saveProgress(force: true);
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
            // Embedded tracks have no identifier worth persisting (mpv's own id isn't stable/
            // portable across opens or players) — leaves any existing saved preference untouched.
            _selectedSubtitleTrack = t;
            _player.setSubtitleTrack(_selectedSubtitleTrack);
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
            // "Default" clears any remembered override (language/title both null still counts as
            // a real, explicit preference — see _hasAudioPreference); a specific track remembers
            // its language+title, the only identifier stable enough to look up again on any player.
            _hasAudioPreference = true;
            _audioPreferenceLanguage = t.id == 'auto' ? null : t.language;
            _audioPreferenceTitle = t.id == 'auto' ? null : t.title;
            _saveProgress(force: true);
            _closePanels();
          },
        );
      }).toList(),
    );
  }

  // Reapplies the remembered audio-track preference (see _hasAudioPreference) whenever the track
  // list updates — covers both the initial open and every reopen (quality change, auto-quality
  // step). mpv's own track ids aren't stable across opens, so matching is by language+title, the
  // only identifier that survives a reopen (or even a different player/platform, since the
  // preference is saved server-side keyed by those same two fields).
  void _maybeApplyAudioPreference() {
    if (!_hasAudioPreference) return;
    if (_track.audio.language == _audioPreferenceLanguage && _track.audio.title == _audioPreferenceTitle) {
      return; // already matches — avoid re-issuing setAudioTrack on every unrelated track update
    }
    for (final t in _tracks.audio) {
      if (t.id == 'no') continue;
      if (t.language == _audioPreferenceLanguage && t.title == _audioPreferenceTitle) {
        _player.setAudioTrack(t);
        return;
      }
    }
  }
}
