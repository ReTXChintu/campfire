import 'dart:async';
import 'dart:io' show Platform;
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:media_kit/media_kit.dart';
import 'package:media_kit_video/media_kit_video.dart';
import 'package:screen_brightness/screen_brightness.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:volume_controller/volume_controller.dart';
import 'package:window_manager/window_manager.dart';
import '../config.dart';
import '../models/catalog.dart';
import '../platform_info.dart';
import '../services/catalog_service.dart';
import '../services/media_session_service.dart';
import '../services/media_token_service.dart';
import '../services/party_sync_engine.dart';
import '../services/pip_service.dart';
import '../services/watch_party_sync_controller.dart';
import '../theme/app_theme.dart';
import '../utils/media_meta.dart';
import '../utils/start_tracks.dart';
import 'episodes_panel.dart';
import 'opinion_buttons.dart';
import 'player_chrome.dart';
import 'title_meta_views.dart';
import 'tv_focusable.dart';
import 'trickplay_preview.dart';
import 'up_next.dart';

// TEMP diagnostic logging — remove once the Android resume/subtitle investigation is done.
void _dbg(String msg) => debugPrint('[MKV ${DateTime.now().toIso8601String().substring(11, 23)}] $msg');

const _speedOptions = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
const _hideControlsDelay = Duration(seconds: 3);
const _saveInterval = Duration(seconds: 10);
const _skipSeconds = 10;

/// Desktop: the player's own volume is remembered between sessions, like any desktop player's.
const _volumePrefKey = 'player_volume';

/// Two clicks this close together (and close on screen) are a double-click.
const _doubleClickWindow = Duration(milliseconds: 300);

/// How often a follower re-checks its drift, and the leader's heartbeat cadence (every 6th tick).
const _partyTick = Duration(milliseconds: 500);
const _partyHeartbeatEvery = 6;

enum _Menu { none, subtitles, audio, speed, episodes, sources }

/// The one and only player, on every platform (libmpv via media_kit) — it decodes any container
/// directly, exposes whatever audio/subtitle tracks are embedded in it, and seeks MKV's raw bytes
/// for real (seekMode: "raw").
///
/// - "native"/"raw": real seeking via player.seek() — the backend serves true Range-seekable bytes.
/// - "restart": the ffmpeg-remux fallback — no Range support, so seeking reopens the stream at a
///   new `t=` offset instead, and duration comes from a probe.
///
/// Layout follows the approved phone design: a top row (back, title, watch party), centre
/// controls (−10s, play, +10s), and a bottom block (scrub bar with buffered range and intro/outro
/// ticks, elapsed / −remaining, then tracks, speed, episodes, PiP and full screen). On a phone held
/// upright the video sits at the top with the title, actions and the episode list below it; turned
/// sideways — or with the full-screen button — it fills the screen.
///
/// Watch party: see [WatchPartySyncController] and services/party_sync_engine.dart. This widget is
/// the half that actually steers playback.
class MediaKitVideoPlayer extends StatefulWidget {
  final VideoResponse video;
  final WatchPartySyncController? watchPartySync;

  /// A hosted source's HLS stream (Bunny, Cloudflare) to play instead of the library's file: real
  /// seeking, no media token, previews or party sync.
  final SourceStream? stream;

  /// Caption files the host keeps beside the stream, after the video's own uploaded ones.
  final List<ConvertedSubtitle> extraSubtitles;

  /// The source this plays from, carried to the next episode; null in a watch party.
  final String? sourceId;

  /// Every source the viewer could switch to (the switch is hidden with fewer than two).
  final List<ViewerSource> sources;
  final PlayerFeatures features;

  /// Where to start instead of the saved position (carried over from a source switch).
  final double? startAt;

  /// It couldn't be played from this source at all; null keeps the error on the player.
  final void Function(double? positionSeconds)? onFailed;
  final void Function(String sourceId, double positionSeconds)? onSwitchSource;

  const MediaKitVideoPlayer({
    super.key,
    required this.video,
    this.watchPartySync,
    this.stream,
    this.extraSubtitles = const [],
    this.sourceId,
    this.sources = const [],
    this.features = const PlayerFeatures(),
    this.startAt,
    this.onFailed,
    this.onSwitchSource,
  });

  @override
  State<MediaKitVideoPlayer> createState() => _MediaKitVideoPlayerState();
}

class _MediaKitVideoPlayerState extends State<MediaKitVideoPlayer> with WidgetsBindingObserver {
  /// Full screen survives moving to another episode: the next player picks it up from here.
  static bool _carryForcedLandscape = false;

  // libass on Android/Windows so image-based subtitles (PGS/DVD) render; Android needs a bundled
  // font for it (see pubspec's NotoSans asset).
  late final Player _player = Player(
    configuration: Platform.isAndroid
        ? const PlayerConfiguration(
            libass: true,
            libassAndroidFont: 'assets/fonts/NotoSans-Regular.ttf',
            libassAndroidFontName: 'Noto Sans',
          )
        : PlayerConfiguration(libass: Platform.isWindows),
  );
  // Android TV: `mediacodec-copy` avoids a Surface-handoff race some TV firmwares lose (solid green
  // video with audio playing). Phones keep the faster default.
  late final VideoController _controller = VideoController(
    _player,
    configuration: VideoControllerConfiguration(hwdec: isAndroidTv ? 'mediacodec-copy' : null),
  );
  final List<StreamSubscription> _subs = [];

  bool _isBuffering = true;
  bool _controlsVisible = true;
  _Menu _menu = _Menu.none;
  bool _endedHandled = false;
  Timer? _hideTimer;
  DateTime _lastSave = DateTime.fromMillisecondsSinceEpoch(0);
  double _speed = 1;
  double? _scrubSeconds;
  bool _skipOrientationRestoreOnDispose = false;

  // Windows: the OS window's own full screen.
  bool _isFullscreen = false;
  // Phone: the full-screen button locks landscape (and back unlocks it again first).
  bool _forcedLandscape = false;
  bool? _lastLaidOutLandscape;

  bool _resumeSeekComplete = true;
  String? _mediaToken;
  String? _errorMessage;
  Offset? _doubleTapLocalPosition;
  String? _hint; // a transient line over the video ("The host is controlling playback")
  Timer? _hintTimer;

  Completer<void> _firstPositionTickCompleter = Completer<void>();
  bool _sawFirstPositionTick = false;

  // Android brightness/volume swipe gestures.
  bool? _dragIsLeftSide;
  double _dragAccumulatedDy = 0;
  double? _dragStartBrightness;
  double? _dragStartVolume;
  double? _brightnessOverlay;
  Timer? _overlayHideTimer;

  bool _lastPipEligible = false;

  // Desktop (Windows): mouse, wheel and the player's own volume. A phone keeps its touch
  // gestures and hardware volume buttons; none of this applies there.
  bool get _isDesktop => Platform.isWindows;
  double _volume = 100; // 0–200; past 100 is a boost
  bool _muted = false;
  double? _volumeHud; // shown for a moment while the wheel or a key changes it
  Timer? _volumeHudTimer;
  Timer? _volumeSaveTimer;
  DateTime? _lastClickAt;
  Offset? _lastClickPos;
  int _clickChain = 0;
  ({bool forward, int seconds})? _seekHud; // "+20 s" after a double-click seek
  Timer? _seekHudTimer;
  Offset? _lastHoverPos;

  // Up next (see widgets/up_next.dart): the card near the end, its countdown, and the end screen.
  bool _autoplay = true;
  bool _upNextShown = false;
  bool _upNextDismissed = false;
  double? _upNextLeft; // seconds of countdown left; null when not counting
  Timer? _upNextTimer;
  bool _endScreen = false;

  // Seek-bar previews: none until the backend has made them (the first play asks it to).
  TrickplayManifest? _trickplay;
  Map<String, String> _trickplayHeaders = const {};
  Timer? _trickplayRetry;
  int _trickplayTries = 0;

  Duration _position = Duration.zero;
  Duration _duration = Duration.zero;
  Duration _buffered = Duration.zero;
  bool _playing = false;
  Tracks _tracks = const Tracks();
  Track _track = const Track();
  ProbeResult? _probe;

  // The user's actual subtitle choice, re-applied after any reopen (restart-mode seeks).
  SubtitleTrack _selectedSubtitleTrack = SubtitleTrack.no();

  // Remembered track preferences, saved with progress and reapplied on later opens.
  String? _subtitlePreferenceSource; // "off" | "external" | "embedded" | null
  int? _subtitlePreferenceIndex;
  String? _subtitlePreferenceLanguage;
  String? _subtitlePreferenceTitle;
  // mpv's own tags for the picked audio, which is what re-finding it in the track list matches on.
  String? _audioPreferenceLanguage;
  String? _audioPreferenceTitle;
  // What's saved as audioLanguage: the canonical code from `audioTracks` when the backend has
  // one, since an admin may have named a track the file leaves as "und".
  String? _audioSaveLanguage;
  bool _hasAudioPreference = false;

  // The backend's startAudio/startSubtitle (see utils/start_tracks.dart), applied once as soon as
  // mpv reports the file's tracks. Cleared by the viewer's own pick or the party's, so a later
  // track-list update can never switch a choice someone made back to the start one.
  bool _startAudioPending = false;
  bool _startSubtitlePending = false;

  // ---- Watch party ------------------------------------------------------------------------------
  final _engine = PartySyncEngine();
  PartyPlaybackState? _partyTarget;
  int _seenTargetVersion = 0;
  bool _partyReady = false;
  bool _wasSyncEnabled = false;
  Timer? _partyTimer;
  int _partyTicks = 0;
  DateTime? _syncSeekIssuedAt;
  PartyTrackChoice? _appliedPartyAudio;
  PartyTrackChoice? _appliedPartySubtitle;

  VideoResponse get video => widget.video;
  WatchPartySyncController? get _sync => widget.watchPartySync;

  /// Played from a host, or as a title the library has no file for: nothing to probe or preview.
  bool get _hasFile => widget.stream == null && !video.isTitle;

  late final List<ConvertedSubtitle> _subtitles = [...video.subtitles, ...widget.extraSubtitles];

  bool get _canSwitchSource =>
      widget.onSwitchSource != null && widget.sources.length > 1 && widget.features.sourceMenu;

  /// Sync applies to truly seekable content (native and raw MKV — both Range-seekable through
  /// libmpv). Restart-mode can't land on an exact position, so it never syncs.
  bool get _syncEnabled => widget.stream == null && (video.isNative || video.isRaw) && (_sync?.enabled ?? false);

  /// Following the party (not "on my own") without the right to drive it: playback controls are
  /// locked, because anything done locally would just be undone by the next sync.
  bool get _locked => _syncEnabled && (_sync?.following ?? true) && !(_sync?.canControl ?? false);

  bool get _streamIsSeekable => widget.stream != null || video.isNative || video.isRaw;

  bool get _isPhone => Platform.isAndroid && !isAndroidTv;

  Duration get _effectiveDuration {
    if (_duration > Duration.zero) return _duration;
    final probeSeconds = _probe?.durationSeconds;
    if (probeSeconds != null) return Duration(milliseconds: (probeSeconds * 1000).round());
    final videoSeconds = video.durationSeconds;
    if (videoSeconds != null) return Duration(milliseconds: (videoSeconds * 1000).round());
    return Duration.zero;
  }

  double get _positionSeconds => _position.inMilliseconds / 1000;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _configureOrientation();
    if (isAndroidTv) _controlsVisible = false;
    if (_isDesktop) _initDesktopVolume();
    if (_hasFile) _loadTrickplay();
    SharedPreferences.getInstance().then((prefs) {
      final saved = prefs.getBool(upNextAutoplayPrefKey);
      if (saved != null && mounted) setState(() => _autoplay = saved);
    }).catchError((_) {});

    if (video.hasStartTracks) {
      _initStartTracks();
    } else {
      _initRememberedTracks();
    }

    _subs.addAll([
      _player.stream.position.listen((p) {
        if (!mounted) return;
        if (!_sawFirstPositionTick && p > Duration.zero) {
          _sawFirstPositionTick = true;
          if (!_firstPositionTickCompleter.isCompleted) _firstPositionTickCompleter.complete();
        }
        setState(() => _position = p);
        _maybeSave();
        _maybeAutoAdvance();
        _updateUpNext();
        MediaSessionService.updateState(playing: _playing, position: p, speed: _speed);
      }),
      _player.stream.duration.listen((d) {
        if (mounted) setState(() => _duration = d);
      }),
      _player.stream.buffer.listen((b) {
        if (mounted) setState(() => _buffered = b);
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
        setState(() => _isBuffering = b);
        // A sync seek has resumed: how long that took is how far ahead the next one should aim.
        if (!b && _syncSeekIssuedAt != null) {
          _engine.recordSeekLatency(DateTime.now().difference(_syncSeekIssuedAt!).inMilliseconds / 1000);
          _syncSeekIssuedAt = null;
        }
      }),
      _player.stream.tracks.listen((t) {
        if (!mounted) return;
        setState(() => _tracks = t);
        _maybeApplyStartTracks();
        _maybeApplyAudioPreference();
        // The party's track choice may have arrived before this file's track list did.
        final target = _partyTarget;
        if (target != null && _syncEnabled) _applyPartyTracks(target);
      }),
      _player.stream.track.listen((t) {
        if (mounted) setState(() => _track = t);
      }),
      _player.stream.completed.listen((completed) {
        if (completed && !_endedHandled) {
          _endedHandled = true;
          _onEnded();
        }
      }),
      _player.stream.error.listen((message) {
        _dbg('player ERROR: $message');
        if (!mounted) return;
        // Never started: this source can't play it, and the viewer is offered the others.
        final failed = widget.onFailed;
        if (failed != null && !_sawFirstPositionTick) {
          failed(widget.startAt ?? (video.initialCompleted ? null : video.initialPositionSeconds));
          return;
        }
        setState(() => _errorMessage = message);
      }),
    ]);
    _bootstrap();
    _scheduleHide();
    _sync?.addListener(_onSyncControllerChanged);

    MediaSessionService.attach(
      title: video.title,
      duration: video.durationSeconds != null ? Duration(milliseconds: (video.durationSeconds! * 1000).round()) : null,
      onPlay: () {
        if (!_playing) _togglePlay();
      },
      onPause: () {
        if (_playing) _togglePlay();
      },
      onSeek: (position) => _userSeekTo(position.inMilliseconds / 1000),
      onSkipNext: video.nextFileId == null ? null : () => _goToNext(),
      onSkipPrevious: video.previousFileId == null ? null : () => _navigateToEpisode(video.previousFileId!),
    );
  }

  /// An older backend: re-find the remembered picks by name (initialAudio*/initialSubtitle*).
  void _initRememberedTracks() {
    _subtitlePreferenceSource = video.initialSubtitleSource == 'off' || video.initialSubtitleSource == 'external'
        ? video.initialSubtitleSource
        : null;
    _subtitlePreferenceIndex = video.initialSubtitleIndex;
    _subtitlePreferenceLanguage = video.initialSubtitleLanguage;
    _subtitlePreferenceTitle = video.initialSubtitleTitle;
    if (video.initialAudioLanguage != null || video.initialAudioTitle != null) {
      _hasAudioPreference = true;
      _audioPreferenceLanguage = video.initialAudioLanguage;
      _audioSaveLanguage = video.initialAudioLanguage;
      _audioPreferenceTitle = video.initialAudioTitle;
    }
    if (_subtitlePreferenceSource == 'external') {
      ConvertedSubtitle? match;
      if (_subtitlePreferenceLanguage != null || _subtitlePreferenceTitle != null) {
        for (final s in _subtitles) {
          if (s.language == _subtitlePreferenceLanguage && s.title == _subtitlePreferenceTitle) {
            match = s;
            break;
          }
        }
      } else if (_subtitlePreferenceIndex != null &&
          _subtitlePreferenceIndex! >= 0 &&
          _subtitlePreferenceIndex! < _subtitles.length) {
        match = _subtitles[_subtitlePreferenceIndex!];
      }
      if (match != null) {
        _selectedSubtitleTrack = SubtitleTrack.data(match.vtt, title: match.title, language: match.language);
      }
    }
  }

  /// A backend that already worked out where to start (this video's pick, the series' last one,
  /// the profile languages, an admin's default). Off and an uploaded file don't need mpv's track
  /// list, so they're set before the stream opens, as a remembered upload always was; the audio
  /// and an embedded subtitle wait for it.
  ///
  /// Nothing here is recorded as a pick: saving it would turn a profile language into this
  /// video's own choice, and the server works the start out again on every open anyway.
  void _initStartTracks() {
    // A restart-mode stream is a remux with one audio track and no subtitles, so mpv's ids there
    // say nothing about the file's own track numbers.
    _startAudioPending = video.startAudio != null && _tracksMatchFile;
    final start = video.startSubtitle;
    if (start == null) return;
    if (start.isEmbedded) {
      _startSubtitlePending = _tracksMatchFile;
      return;
    }
    final subtitle = planStartTracks(
      startAudio: null,
      startSubtitle: start,
      audioIds: const [],
      subtitleIds: const [],
      tracksKnown: false,
      externalCount: _subtitles.length,
    ).subtitle;
    if (subtitle == null) return;
    if (subtitle.isOff) {
      _selectedSubtitleTrack = SubtitleTrack.no();
    } else {
      final s = _subtitles[subtitle.index!];
      _selectedSubtitleTrack = SubtitleTrack.data(s.vtt, title: s.title, language: s.language);
      // What the menu's tick and a party announcement read. Not saved: there's no source.
      _subtitlePreferenceIndex = s.index;
      _subtitlePreferenceLanguage = s.language;
      _subtitlePreferenceTitle = s.title;
    }
  }

  /// The start audio / embedded subtitle, once mpv has said which tracks the file has.
  void _maybeApplyStartTracks() {
    if (!_startAudioPending && !_startSubtitlePending) return;
    bool real(String id) => id != 'auto' && id != 'no';
    final audio = _tracks.audio.where((t) => real(t.id)).toList();
    final subtitles = _tracks.subtitle.where((t) => real(t.id)).toList();
    final plan = planStartTracks(
      startAudio: _startAudioPending ? video.startAudio : null,
      startSubtitle: _startSubtitlePending ? video.startSubtitle : null,
      audioIds: [for (final t in audio) t.id],
      subtitleIds: [for (final t in subtitles) t.id],
      tracksKnown: audio.isNotEmpty || subtitles.isNotEmpty || _tracks.video.any((t) => real(t.id)),
      externalCount: _subtitles.length,
    );
    if (_startAudioPending && !plan.audioPending) {
      _startAudioPending = false;
      final track = audio.where((t) => t.id == plan.audioId).firstOrNull;
      if (track != null && _track.audio.id != track.id) _player.setAudioTrack(track);
    }
    if (_startSubtitlePending && !plan.subtitlePending) {
      _startSubtitlePending = false;
      final n = plan.subtitle?.n;
      final track = n == null ? null : subtitles.where((t) => t.id == '$n').firstOrNull;
      if (track != null) _selectSubtitle(track);
    }
  }

  /// mpv numbers a file's tracks the way the backend's `n` does — except in a restart-mode remux.
  bool get _tracksMatchFile => widget.stream == null && _streamIsSeekable;

  ViewerTrack? _viewerAudio(String id) =>
      _tracksMatchFile ? video.audioTracks?.where((t) => t.mpvId == id).firstOrNull : null;

  ViewerTrack? _viewerSubtitle(String id) =>
      _tracksMatchFile ? video.subtitleTracks?.where((t) => t.mpvId == id).firstOrNull : null;

  Uri _streamUri({double restartOffsetSeconds = 0}) {
    final hosted = widget.stream;
    if (hosted != null) return Uri.parse(hosted.url);
    final params = <String, String>{'token': ?_mediaToken};
    if (video.isRaw) {
      params['raw'] = '1';
    } else if (!_streamIsSeekable && restartOffsetSeconds > 0) {
      params['t'] = restartOffsetSeconds.floor().toString();
    }
    final base = '$apiBaseUrl/api/stream/${video.fileId}';
    return params.isEmpty ? Uri.parse(base) : Uri.parse(base).replace(queryParameters: params);
  }

  Future<void> _bootstrap() async {
    if (_hasFile) {
      CatalogService.fetchProbe(video.fileId).then((p) {
        if (mounted) setState(() => _probe = p);
      }).catchError((_) {});

      try {
        _mediaToken = await MediaTokenService.mint(video.fileId);
      } catch (_) {
        // The stream request will 401 and surface through the error stream.
      }
      if (!mounted) return;
    }

    // Opened into a watch party: the party decides where playback starts, not this account's own
    // saved resume point — that's what used to put every guest somewhere different on join.
    final inParty = _sync?.initialPartyId != null;
    final carried = widget.startAt;
    final resumeSeconds = inParty
        ? 0.0
        : carried != null
            ? (carried > 5 ? carried : 0.0)
            : (!video.initialCompleted && video.initialPositionSeconds > 5)
                ? video.initialPositionSeconds
                : 0.0;
    final needsResumeSeek = resumeSeconds > 0 && _streamIsSeekable;
    if (needsResumeSeek) _resumeSeekComplete = false;
    _firstPositionTickCompleter = Completer<void>();
    _sawFirstPositionTick = false;
    await _player.open(Media(_streamUri(restartOffsetSeconds: resumeSeconds).toString()));
    await _player.setRate(_speed);
    await _player.setSubtitleTrack(_selectedSubtitleTrack);
    if (needsResumeSeek) {
      // A seek issued before playback has genuinely started is silently dropped by mpv.
      await _firstPositionTickCompleter.future;
      await _player.seek(Duration(milliseconds: (resumeSeconds * 1000).round()));
    }
    _resumeSeekComplete = true;
    _onPlayerReadyForParty();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _hideTimer?.cancel();
    _volumeHudTimer?.cancel();
    _volumeSaveTimer?.cancel();
    _seekHudTimer?.cancel();
    _upNextTimer?.cancel();
    _trickplayRetry?.cancel();
    _hintTimer?.cancel();
    _overlayHideTimer?.cancel();
    _partyTimer?.cancel();
    for (final sub in _subs) {
      sub.cancel();
    }
    _saveProgress(force: true);
    if (!_skipOrientationRestoreOnDispose) _restoreSystemChrome();
    if (!_firstPositionTickCompleter.isCompleted) _firstPositionTickCompleter.complete();
    _player.dispose();
    _sync?.removeListener(_onSyncControllerChanged);
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

  @override
  void didChangeMetrics() {
    // Rotation: immersive while sideways, normal system bars while upright.
    WidgetsBinding.instance.addPostFrameCallback((_) => _syncSystemUiToOrientation());
  }

  // ===============================================================================================
  // Watch party

  void _onSyncControllerChanged() {
    if (!mounted) return;
    final sync = _sync;
    if (sync == null) return;

    final enabled = _syncEnabled;
    if (enabled && !_wasSyncEnabled) _startPartyTimer();
    if (!enabled && _wasSyncEnabled) {
      _partyTimer?.cancel();
      _partyTarget = null;
      if (_player.state.rate != _speed) _player.setRate(_speed);
    }
    _wasSyncEnabled = enabled;

    // Watching on our own: whatever catch-up rate sync had set goes back to the chosen speed.
    if (enabled && !sync.following && _player.state.rate != _speed) _player.setRate(_speed);

    if (sync.targetVersion != _seenTargetVersion) {
      _seenTargetVersion = sync.targetVersion;
      final target = sync.target;
      if (target != null && enabled) _onPartyTarget(target);
    }
    setState(() {});
  }

  void _startPartyTimer() {
    _partyTimer?.cancel();
    _partyTicks = 0;
    _partyTimer = Timer.periodic(_partyTick, (_) => _onPartyTick());
  }

  void _onPartyTarget(PartyPlaybackState state) {
    final sync = _sync;
    // A brand-new party whose leader is us: our position becomes the party's — never the empty
    // party's 0:00 applied to us. If the player is already playing (the usual case: started a
    // party mid-film), announce now; otherwise _onPlayerReadyForParty will.
    if (sync != null && sync.announceOnReady && sync.canControl) {
      if (_partyReady) {
        sync.clearAnnounceOnReady();
        _announce(PartyStateKind.action);
      }
      return;
    }
    if (!_engine.accept(state)) return;
    _partyTarget = state;
    if (!_partyReady) return; // applied once the player is actually playing (_onPlayerReadyForParty)
    _applyPartyTarget(explicit: state.kind != PartyStateKind.heartbeat);
  }

  /// Bootstrap finished. A seek before the first real position tick is dropped by mpv, so the
  /// party's position waits for that tick too.
  Future<void> _onPlayerReadyForParty() async {
    await _firstPositionTickCompleter.future.timeout(const Duration(seconds: 20), onTimeout: () {});
    if (!mounted) return;
    _partyReady = true;
    final sync = _sync;
    if (sync == null || !_syncEnabled) return;
    if (sync.announceOnReady && sync.canControl) {
      // A brand-new party: our own position (maybe an hour in) becomes the party's.
      sync.clearAnnounceOnReady();
      _announce(PartyStateKind.action);
      return;
    }
    if (_partyTarget != null) _applyPartyTarget(explicit: true);
  }

  void _onPartyTick() {
    final sync = _sync;
    if (!mounted || sync == null || !_syncEnabled || !_partyReady) return;
    _partyTicks++;
    if (sync.isLeader) {
      if (_partyTicks % _partyHeartbeatEvery == 0) _announce(PartyStateKind.heartbeat);
      sync.reportHealth(_isBuffering ? SyncHealth.buffering : (_playing ? SyncHealth.synced : SyncHealth.paused));
      return;
    }
    if (sync.following && _partyTarget != null) _applyPartyTarget(explicit: false);
    sync.reportHealth(_engine.health(
      target: _partyTarget,
      serverNowMs: sync.clock.nowServerMs(),
      localPositionSeconds: _positionSeconds,
      localBuffering: _isBuffering,
      following: sync.following,
    ));
  }

  void _applyPartyTarget({required bool explicit}) {
    final sync = _sync;
    final target = _partyTarget;
    if (sync == null || target == null || !sync.following) return;
    // The leader is the truth: it takes other controllers' actions, never anyone's heartbeat.
    if (sync.isLeader && target.kind == PartyStateKind.heartbeat) return;

    if (target.fileId != null && target.fileId != video.fileId) {
      // Saving first, then the overlay reopens us on the party's episode.
      _saveProgress(force: true);
      _skipOrientationRestoreOnDispose = true;
      _carryForcedLandscape = _forcedLandscape;
      sync.followFile(target.fileId!);
      return;
    }

    _applyPartyTracks(target);
    if (_speed != target.playbackRate) setState(() => _speed = target.playbackRate);

    final durationSeconds = _effectiveDuration.inMilliseconds / 1000;
    final correction = _engine.decide(
      target: target,
      serverNowMs: sync.clock.nowServerMs(),
      localPositionSeconds: _positionSeconds,
      localPlaying: _playing,
      localBuffering: _isBuffering,
      currentRate: _player.state.rate,
      explicit: explicit,
      durationSeconds: durationSeconds > 0 ? durationSeconds : null,
    );
    if (correction.isNone) return;
    if (correction.rate != null) _player.setRate(correction.rate!);
    if (correction.seekToSeconds != null) {
      _syncSeekIssuedAt = DateTime.now();
      _seekInternal(correction.seekToSeconds!);
    }
    if (correction.setPlaying == true) _player.play();
    if (correction.setPlaying == false) _player.pause();
  }

  PartyTrackChoice _currentAudioChoice() {
    final a = _track.audio;
    if (a.id == 'auto' || a.id == 'no') return PartyTrackChoice(id: a.id);
    return PartyTrackChoice(id: a.id, language: a.language, title: a.title);
  }

  PartyTrackChoice _currentSubtitleChoice() {
    final s = _selectedSubtitleTrack;
    if (s.id == 'no') return PartyTrackChoice.off;
    if (s.data) {
      return PartyTrackChoice(
        source: 'external',
        index: _subtitlePreferenceIndex,
        language: _subtitlePreferenceLanguage,
        title: _subtitlePreferenceTitle,
      );
    }
    return PartyTrackChoice(source: 'embedded', id: s.id, language: s.language, title: s.title);
  }

  /// Everyone hears the same language and reads the same subtitles: whatever the party's
  /// controller last picked is applied here — once per change, so a guest can still switch their
  /// own subtitles afterwards without being overridden every heartbeat.
  void _applyPartyTracks(PartyPlaybackState target) {
    final audio = target.audio;
    if (audio != null && audio != _appliedPartyAudio && _applyAudioChoice(audio)) {
      _appliedPartyAudio = audio;
      _startAudioPending = false;
    }
    final subtitle = target.subtitle;
    if (subtitle != null && subtitle != _appliedPartySubtitle && _applySubtitleChoice(subtitle)) {
      _appliedPartySubtitle = subtitle;
      _startSubtitlePending = false;
    }
  }

  /// False when this file's tracks aren't known yet — retried when they are.
  bool _applyAudioChoice(PartyTrackChoice choice) {
    if (choice.id == 'auto' || choice.id == null && choice.language == null && choice.title == null) {
      if (_track.audio.id != 'auto') _player.setAudioTrack(AudioTrack.auto());
      _hasAudioPreference = false;
      return true;
    }
    final real = _tracks.audio.where((t) => t.id != 'auto' && t.id != 'no').toList();
    if (real.isEmpty) return false;
    AudioTrack? match = real.where((t) => t.id == choice.id && t.language == choice.language).firstOrNull;
    match ??= real.where((t) => t.language == choice.language && t.title == choice.title).firstOrNull;
    match ??= real.where((t) => t.language != null && t.language == choice.language).firstOrNull;
    match ??= real.where((t) => t.id == choice.id).firstOrNull;
    if (match == null) return true; // this file has no such track — nothing to do, don't retry
    if (_track.audio.id != match.id) _player.setAudioTrack(match);
    // Becomes this video's remembered pick too, so the preference re-apply on the next track
    // update doesn't switch it straight back.
    _hasAudioPreference = true;
    _audioPreferenceLanguage = match.language;
    _audioSaveLanguage = _viewerAudio(match.id)?.language ?? match.language;
    _audioPreferenceTitle = match.title;
    return true;
  }

  bool _applySubtitleChoice(PartyTrackChoice choice) {
    switch (choice.source) {
      case 'off':
        _selectSubtitle(SubtitleTrack.no(), source: 'off');
        return true;
      case 'external':
        ConvertedSubtitle? match = _subtitles.where((s) => s.index == choice.index).firstOrNull;
        match ??= _subtitles
            .where((s) => s.language == choice.language && s.title == choice.title)
            .firstOrNull;
        if (match == null) return true;
        _selectSubtitle(
          SubtitleTrack.data(match.vtt, title: match.title, language: match.language),
          source: 'external',
          external: match,
        );
        return true;
      case 'embedded':
        final embedded = _tracks.subtitle.where((t) => t.id != 'auto' && t.id != 'no').toList();
        if (embedded.isEmpty) return false;
        final match = embedded.where((t) => t.id == choice.id).firstOrNull ??
            embedded.where((t) => t.language == choice.language && t.title == choice.title).firstOrNull;
        if (match == null) return true;
        _selectSubtitle(match, source: _embeddedSource);
        return true;
      default:
        return true;
    }
  }

  PartyPlaybackState _partyState(
    PartyStateKind kind, {
    bool? playing,
    double? positionSeconds,
    String? fileId,
  }) {
    final sync = _sync!;
    return PartyPlaybackState(
      kind: kind,
      playing: playing ?? _playing,
      positionSeconds: positionSeconds ?? _positionSeconds,
      playbackRate: _speed,
      serverTimeMs: sync.clock.nowServerMs(),
      fileId: fileId ?? video.fileId,
      audio: _currentAudioChoice(),
      subtitle: _currentSubtitleChoice(),
    );
  }

  /// Sends what this device just did (or, for the leader, where it is) to the party.
  void _announce(PartyStateKind kind, {bool? playing, double? positionSeconds, String? fileId}) {
    final sync = _sync;
    if (sync == null || !_syncEnabled || !sync.canControl || !_partyReady && kind == PartyStateKind.heartbeat) return;
    final state = _partyState(kind, playing: playing, positionSeconds: positionSeconds, fileId: fileId);
    if (kind == PartyStateKind.action) {
      _engine.accept(state);
      _appliedPartyAudio = state.audio;
      _appliedPartySubtitle = state.subtitle;
    }
    _partyTarget = state;
    sync.announce(state);
  }

  /// A locked control was touched: say why instead of silently doing nothing.
  bool _blockIfLocked() {
    if (!_locked) return false;
    _showHint('The host is controlling playback. Turn off "Keep me in sync" in the party to watch on your own.');
    return true;
  }

  void _showHint(String text) {
    _hintTimer?.cancel();
    setState(() => _hint = text);
    _hintTimer = Timer(const Duration(seconds: 4), () {
      if (mounted) setState(() => _hint = null);
    });
  }

  // ===============================================================================================
  // Progress + episodes

  void _maybeSave() {
    final now = DateTime.now();
    if (now.difference(_lastSave) >= _saveInterval) _saveProgress();
  }

  void _saveProgress({bool force = false}) {
    if (!_resumeSeekComplete) return;
    final now = DateTime.now();
    if (!force && now.difference(_lastSave) < const Duration(seconds: 2)) return;
    _lastSave = now;
    CatalogService.saveProgress(
      fileId: video.fileId,
      parentFolderId: video.parentFolderId,
      positionSeconds: _positionSeconds,
      durationSeconds: _effectiveDuration.inMilliseconds / 1000,
      subtitleSource: _subtitlePreferenceSource,
      subtitleIndex: _subtitlePreferenceSource == null ? unsetProgressField : _subtitlePreferenceIndex,
      subtitleLanguage: _subtitlePreferenceSource == null ? unsetProgressField : _subtitlePreferenceLanguage,
      subtitleTitle: _subtitlePreferenceSource == null ? unsetProgressField : _subtitlePreferenceTitle,
      audioLanguage: _hasAudioPreference ? _audioSaveLanguage : unsetProgressField,
      audioTitle: _hasAudioPreference ? _audioPreferenceTitle : unsetProgressField,
    ).catchError((_) {});
  }

  void _maybeAutoAdvance() {
    if (_endedHandled) return;
    final duration = _effectiveDuration;
    if (duration <= Duration.zero) return;
    if (_position >= duration - const Duration(milliseconds: 300) && !_playing) {
      _endedHandled = true;
      _onEnded();
    }
  }

  /// Asks for the previews, and while they're being made asks again now and then — a film's set
  /// is usually ready a few minutes into its first play.
  Future<void> _loadTrickplay() async {
    final result = await fetchTrickplay(video.fileId);
    if (!mounted) return;
    if (result.manifest != null) {
      final headers = await trickplayHeaders();
      if (!mounted) return;
      setState(() {
        _trickplay = result.manifest;
        _trickplayHeaders = headers;
      });
      return;
    }
    if (result.pending && ++_trickplayTries < 8) {
      _trickplayRetry = Timer(const Duration(seconds: 90), _loadTrickplay);
    }
  }

  // ===============================================================================================
  // Up next

  /// After [upNextStreakLimit] titles started on their own, the next waits for the viewer. Not in
  /// a watch party: there the room is plainly still watching, and the host moves everyone on.
  bool get _needsStillWatching => !_syncEnabled && upNextAutoplayStreak >= upNextStreakLimit;

  /// Where the card appears: the credits, when they're known, else 25 seconds from the end.
  double? get _upNextAt {
    if (video.upNext == null) return null;
    final total = _effectiveDuration.inMilliseconds / 1000;
    final outro = video.outroStart;
    if (outro != null && (total <= 0 || outro < total)) return outro;
    if (total < 90) return null; // a clip too short to have an ending worth skipping
    return total - 25;
  }

  void _updateUpNext() {
    final at = _upNextAt;
    if (at == null) return;
    final pos = _positionSeconds;
    final total = _effectiveDuration.inMilliseconds / 1000;
    // Seeking back out of the ending puts everything back as it was.
    if (pos < at - 2) {
      if (_upNextShown || _endScreen || _endedHandled) {
        _upNextTimer?.cancel();
        setState(() {
          _upNextShown = false;
          _upNextLeft = null;
          _endScreen = false;
        });
        _endedHandled = false;
      }
      return;
    }
    if (_endScreen && total > 0 && pos < total - 2) {
      setState(() => _endScreen = false);
      _endedHandled = false;
    }
    if (_upNextShown || _upNextDismissed || _locked || pos < at) return;
    setState(() => _upNextShown = true);
    _startUpNextCountdown();
  }

  void _startUpNextCountdown() {
    final item = video.upNext;
    _upNextTimer?.cancel();
    if (item == null || !_autoplay || _needsStillWatching || _locked) {
      if (_upNextLeft != null) setState(() => _upNextLeft = null);
      return;
    }
    setState(() => _upNextLeft = upNextCountdownSeconds(item).toDouble());
    const tick = Duration(milliseconds: 100);
    _upNextTimer = Timer.periodic(tick, (_) {
      if (!mounted) return;
      // Paused means "wait": the countdown only runs while it plays, or once it has ended.
      if (!_playing && !_endedHandled) return;
      final left = (_upNextLeft ?? 0) - tick.inMilliseconds / 1000;
      if (left <= 0) {
        _upNextTimer?.cancel();
        _autoplayUpNext();
        return;
      }
      setState(() => _upNextLeft = left);
    });
  }

  void _setAutoplay(bool on) {
    setState(() => _autoplay = on);
    SharedPreferences.getInstance().then((prefs) => prefs.setBool(upNextAutoplayPrefKey, on)).catchError((_) => false);
    if (_upNextShown) _startUpNextCountdown();
  }

  void _dismissUpNext() {
    _upNextTimer?.cancel();
    setState(() {
      _upNextDismissed = true;
      _upNextShown = false;
      _upNextLeft = null;
    });
  }

  /// The title finished. Move on by itself when it may; otherwise show what could come next.
  void _onEnded() {
    final next = video.upNext;
    if (next == null) {
      // An older backend: no card, the plain next-episode hop it always did.
      _goToNext(auto: true);
      return;
    }
    if (_locked) return; // the host moves the party on
    if (!_upNextDismissed && _autoplay && !_needsStillWatching) {
      _autoplayUpNext();
      return;
    }
    _upNextTimer?.cancel();
    setState(() {
      _endScreen = true;
      _upNextShown = false;
      _upNextLeft = null;
      _controlsVisible = false;
    });
  }

  void _autoplayUpNext() {
    final next = video.upNext;
    if (next == null || !mounted) return;
    upNextAutoplayStreak++;
    _navigateToEpisode(next.fileId);
  }

  /// The viewer chose it: the streak of unattended plays starts over.
  void _playChosen(UpNextItem item) {
    upNextAutoplayStreak = 0;
    _upNextTimer?.cancel();
    _navigateToEpisode(item.fileId);
  }

  void _watchAgain() {
    _endedHandled = false;
    setState(() {
      _endScreen = false;
      _upNextShown = false;
      _upNextDismissed = false;
      _upNextLeft = null;
    });
    _userSeekTo(0);
    _player.play();
    _announce(PartyStateKind.action, playing: true, positionSeconds: 0);
  }

  /// Leaves the player outright — unlike [_back], which first leaves a forced full screen.
  void _leavePlayer() {
    if (context.canPop()) {
      context.pop();
    } else {
      context.go(video.backHref);
    }
  }

  void _goToNext({bool auto = false}) {
    final next = video.nextFileId;
    if (next == null) return;
    // In a party, a follower's episode ends at the same moment as the leader's — the leader moves
    // everyone on, rather than each device racing to the next file on its own.
    if (auto && _locked) return;
    _navigateToEpisode(next);
  }

  void _navigateToEpisode(String fileId) {
    final sync = _sync;
    final partyId = sync?.partyId;
    if (_syncEnabled && partyId != null) {
      if (_blockIfLocked()) return;
      _saveProgress(force: true);
      _skipOrientationRestoreOnDispose = true;
      // Tell the party first, so everyone follows onto the same episode at its start.
      if (sync!.canControl) _announce(PartyStateKind.action, fileId: fileId, positionSeconds: 0, playing: true);
      _carryForcedLandscape = _forcedLandscape;
      context.pushReplacement('/watch/$fileId?party=$partyId');
      return;
    }
    _saveProgress(force: true);
    _skipOrientationRestoreOnDispose = true;
    _carryForcedLandscape = _forcedLandscape;
    // The next episode plays from the same source.
    final source = widget.sourceId;
    context.pushReplacement(source == null ? '/watch/$fileId' : '/watch/$fileId?source=${Uri.encodeQueryComponent(source)}');
  }

  // ===============================================================================================
  // Playback actions

  void _scheduleHide() {
    _hideTimer?.cancel();
    _hideTimer = Timer(_hideControlsDelay, () {
      if (mounted && _playing && _menu == _Menu.none && _scrubSeconds == null) {
        setState(() => _controlsVisible = false);
      }
    });
  }

  void _showControls() {
    upNextAutoplayStreak = 0;
    setState(() => _controlsVisible = true);
    _scheduleHide();
  }

  void _togglePlay() {
    _showControls();
    if (_blockIfLocked()) return;
    final willPlay = !_playing;
    if (willPlay) {
      _player.play();
    } else {
      _player.pause();
      _saveProgress(force: true);
    }
    // The *intended* state — `_playing` only flips once the player reports back, so reading it
    // here is what used to broadcast "playing" for a pause.
    _announce(PartyStateKind.action, playing: willPlay);
  }

  void _handleDoubleTap() {
    final pos = _doubleTapLocalPosition;
    if (pos == null) return;
    final width = context.size?.width ?? MediaQuery.sizeOf(context).width;
    if (pos.dx < width / 3) {
      _skip(-_skipSeconds);
    } else if (pos.dx > width * 2 / 3) {
      _skip(_skipSeconds);
    } else {
      _togglePlay();
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Desktop: mouse, wheel and volume

  Future<void> _initDesktopVolume() async {
    // mpv allows 130% by default; the boost goes to 200%, as in VLC.
    final platform = _player.platform;
    if (platform is NativePlayer) {
      await platform.setProperty('volume-max', PlayerVolumeControl.max.round().toString());
    }
    var saved = 100.0;
    try {
      saved = (await SharedPreferences.getInstance()).getDouble(_volumePrefKey) ?? 100;
    } catch (_) {
      // No stored preference (or storage unavailable): start at the file's own level.
    }
    if (!mounted) return;
    setState(() => _volume = saved.clamp(0, PlayerVolumeControl.max).toDouble());
    await _player.setVolume(_volume);
  }

  void _flashVolumeHud(double value) {
    setState(() => _volumeHud = value);
    _volumeHudTimer?.cancel();
    _volumeHudTimer = Timer(const Duration(milliseconds: 900), () {
      if (mounted) setState(() => _volumeHud = null);
    });
  }

  void _setVolume(double next, {bool showHud = true}) {
    final value = next.clamp(0, PlayerVolumeControl.max).toDouble();
    setState(() {
      _volume = value;
      _muted = false;
    });
    _player.setVolume(value);
    if (showHud) _flashVolumeHud(value);
    if (_controlsVisible) _scheduleHide(); // keep the controls up while it's being adjusted
    _volumeSaveTimer?.cancel();
    _volumeSaveTimer = Timer(const Duration(milliseconds: 600), () async {
      try {
        await (await SharedPreferences.getInstance()).setDouble(_volumePrefKey, value);
      } catch (_) {
        // Not remembered this time; nothing else depends on it.
      }
    });
  }

  /// One wheel notch or arrow press: 5%. Muted, it unmutes back to where it was, then steps.
  void _nudgeVolume(int steps) => _setVolume(_volume + steps * 5);

  void _toggleMute() {
    final muted = !_muted;
    setState(() => _muted = muted);
    _player.setVolume(muted ? 0 : _volume);
    _flashVolumeHud(muted ? 0 : _volume);
  }

  void _onDesktopHover(PointerHoverEvent event) {
    // A resting trackpad can report tiny moves; those shouldn't hold the controls up forever.
    final last = _lastHoverPos;
    _lastHoverPos = event.localPosition;
    if (last != null && (event.localPosition - last).distance < 3) return;
    if (_controlsVisible) {
      _scheduleHide();
    } else {
      _showControls();
    }
  }

  void _onDesktopScroll(PointerSignalEvent event) {
    if (event is! PointerScrollEvent) return;
    // Registered with the resolver so that anything under the pointer that scrolls itself — an
    // open menu, the episode list — gets the wheel first, and the volume only otherwise.
    GestureBinding.instance.pointerSignalResolver.register(event, (resolved) {
      final dy = (resolved as PointerScrollEvent).scrollDelta.dy;
      if (dy != 0) _nudgeVolume(dy < 0 ? 1 : -1);
    });
  }

  /// Desktop clicks on the video itself (a click on a control never gets here — the control wins
  /// it). One click brings the controls up and never pauses: on a desktop that's what Space and the
  /// play button are for, and pausing by accident on the way to the controls is what this
  /// replaced. Double-click the left or right third to jump 10 s — each further quick click adds
  /// 10 s more, as on YouTube — or the middle to toggle full screen.
  ///
  /// Done by hand from tap-ups rather than with a double-tap recognizer, which would hold every
  /// single click back ~300 ms to see whether a second one follows.
  void _onDesktopClick(Offset localPosition) {
    final now = DateTime.now();
    final last = _lastClickAt;
    final lastPos = _lastClickPos;
    final chained = last != null &&
        now.difference(last) <= _doubleClickWindow &&
        lastPos != null &&
        (localPosition - lastPos).distance < 40;
    _lastClickAt = now;
    _lastClickPos = localPosition;

    if (!chained) {
      _clickChain = 1;
      if (_menu != _Menu.none) {
        _closeMenus();
      } else {
        _showControls();
      }
      return;
    }

    _clickChain++;
    final width = context.size?.width ?? MediaQuery.sizeOf(context).width;
    final x = localPosition.dx;
    if (x < width / 3 || x > width * 2 / 3) {
      final forward = x > width * 2 / 3;
      _skip(forward ? _skipSeconds : -_skipSeconds);
      setState(() => _seekHud = (forward: forward, seconds: (_clickChain - 1) * _skipSeconds));
      _seekHudTimer?.cancel();
      _seekHudTimer = Timer(const Duration(milliseconds: 700), () {
        if (mounted) setState(() => _seekHud = null);
      });
    } else if (_clickChain == 2) {
      _toggleFullscreen();
    }
  }

  Future<void> _reopenAt(double seconds) async {
    setState(() => _isBuffering = true);
    _firstPositionTickCompleter = Completer<void>();
    _sawFirstPositionTick = false;
    await _player.open(Media(_streamUri(restartOffsetSeconds: seconds).toString()));
    await _player.setRate(_speed);
    await _player.setSubtitleTrack(_selectedSubtitleTrack);
  }

  /// Moves playback without telling the party — used by sync itself.
  void _seekInternal(double seconds) {
    if (_streamIsSeekable) {
      _player.seek(Duration(milliseconds: (seconds * 1000).round()));
    } else {
      _reopenAt(seconds);
    }
  }

  /// A seek the viewer asked for: moves playback and tells the party.
  void _userSeekTo(double seconds) {
    if (_blockIfLocked()) return;
    _seekInternal(seconds);
    _announce(PartyStateKind.action, positionSeconds: seconds);
  }

  void _skip(int deltaSeconds) {
    _showControls();
    if (_blockIfLocked()) return;
    var target = _positionSeconds + deltaSeconds;
    if (target < 0) target = 0;
    final duration = _effectiveDuration.inMilliseconds / 1000;
    if (duration > 0 && target > duration) target = duration;
    _seekInternal(target);
    _announce(PartyStateKind.action, positionSeconds: target);
  }

  void _setSpeed(double next) {
    if (_blockIfLocked()) return;
    setState(() => _speed = next);
    _player.setRate(next);
    _announce(PartyStateKind.action);
  }

  // ===============================================================================================
  // Tracks

  /// Applies a subtitle choice. With a [source] it's also recorded as the remembered pick ("off",
  /// "external", "embedded"); without one (the backend's start choice) it's only shown.
  void _selectSubtitle(SubtitleTrack track, {String? source, ConvertedSubtitle? external}) {
    _selectedSubtitleTrack = track;
    _player.setSubtitleTrack(track);
    if (source == 'off') {
      _subtitlePreferenceSource = 'off';
      _subtitlePreferenceIndex = null;
      _subtitlePreferenceLanguage = null;
      _subtitlePreferenceTitle = null;
    } else if (source == 'external' && external != null) {
      _subtitlePreferenceSource = 'external';
      _subtitlePreferenceIndex = external.index;
      _subtitlePreferenceLanguage = external.language;
      _subtitlePreferenceTitle = external.title;
    } else if (source == 'embedded') {
      // Found again on the next open (startTracks in the backend's lib/mediaTracks.ts) by its
      // position first — mpv's id is the file's track number, and files often carry several
      // tracks with identical tags — then by language + title, with the canonical code when the
      // backend has one (the file may say "und" where an admin named the track).
      _subtitlePreferenceSource = 'embedded';
      _subtitlePreferenceIndex = int.tryParse(track.id);
      _subtitlePreferenceLanguage = _viewerSubtitle(track.id)?.language ?? track.language;
      _subtitlePreferenceTitle = track.title;
    }
    if (mounted) setState(() {});
  }

  /// Only a backend that knows the "embedded" source gets embedded picks remembered — an older one
  /// would refuse the whole progress save over it.
  String? get _embeddedSource => video.hasStartTracks ? 'embedded' : null;

  void _maybeApplyAudioPreference() {
    if (!_hasAudioPreference) return;
    if (_track.audio.language == _audioPreferenceLanguage && _track.audio.title == _audioPreferenceTitle) return;
    for (final t in _tracks.audio) {
      if (t.id == 'no') continue;
      if (t.language == _audioPreferenceLanguage && t.title == _audioPreferenceTitle) {
        _player.setAudioTrack(t);
        return;
      }
    }
  }

  String _subtitleLabel() {
    final s = _selectedSubtitleTrack;
    if (s.id == 'no') return 'Off';
    if (!s.data) {
      final named = _viewerSubtitle(s.id);
      if (named != null) return named.label;
    }
    return _languageName(s.language) ?? s.title ?? 'On';
  }

  String _audioLabel() {
    final a = _track.audio;
    if (a.id == 'auto' || a.id == 'no') return 'Default';
    return _viewerAudio(a.id)?.label ?? _languageName(a.language) ?? a.title ?? 'Track ${a.id}';
  }

  static const _languages = {
    'en': 'English', 'eng': 'English', 'hi': 'Hindi', 'hin': 'Hindi', 'ta': 'Tamil', 'tam': 'Tamil',
    'te': 'Telugu', 'tel': 'Telugu', 'ml': 'Malayalam', 'mal': 'Malayalam', 'kn': 'Kannada',
    'kan': 'Kannada', 'bn': 'Bengali', 'ben': 'Bengali', 'mr': 'Marathi', 'mar': 'Marathi',
    'ja': 'Japanese', 'jpn': 'Japanese', 'ko': 'Korean', 'kor': 'Korean', 'es': 'Spanish',
    'spa': 'Spanish', 'fr': 'French', 'fre': 'French', 'fra': 'French', 'de': 'German',
    'ger': 'German', 'deu': 'German', 'zh': 'Chinese', 'chi': 'Chinese', 'zho': 'Chinese',
    'ar': 'Arabic', 'ara': 'Arabic', 'ru': 'Russian', 'rus': 'Russian', 'it': 'Italian', 'ita': 'Italian',
    'pt': 'Portuguese', 'por': 'Portuguese', 'und': null,
  };

  static String? _languageName(String? code) {
    if (code == null || code.isEmpty) return null;
    final lower = code.toLowerCase();
    if (_languages.containsKey(lower)) return _languages[lower];
    return code;
  }

  // ===============================================================================================
  // Orientation + chrome

  void _configureOrientation() {
    if (_isPhone && _carryForcedLandscape) {
      _carryForcedLandscape = false;
      _forcedLandscape = true;
      SystemChrome.setPreferredOrientations([DeviceOrientation.landscapeLeft, DeviceOrientation.landscapeRight]);
      return;
    }
    if (_isPhone) {
      // Free rotation on a phone: upright shows the video with its details below, sideways fills
      // the screen. The full-screen button pins landscape.
      SystemChrome.setPreferredOrientations(DeviceOrientation.values);
    } else if (Platform.isAndroid) {
      SystemChrome.setPreferredOrientations([DeviceOrientation.landscapeLeft, DeviceOrientation.landscapeRight]);
      SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
    }
  }

  void _syncSystemUiToOrientation() {
    if (!mounted || !_isPhone) return;
    final size = MediaQuery.sizeOf(context);
    final landscape = size.width > size.height;
    if (_lastLaidOutLandscape == landscape) return;
    _lastLaidOutLandscape = landscape;
    SystemChrome.setEnabledSystemUIMode(landscape ? SystemUiMode.immersiveSticky : SystemUiMode.edgeToEdge);
    if (!landscape && _menu != _Menu.none) setState(() => _menu = _Menu.none);
  }

  Future<void> _toggleFullscreen() async {
    if (Platform.isWindows) {
      final next = !_isFullscreen;
      await windowManager.setFullScreen(next);
      if (mounted) setState(() => _isFullscreen = next);
      return;
    }
    if (!_isPhone) return;
    final size = MediaQuery.sizeOf(context);
    final landscape = size.width > size.height;
    if (landscape) {
      _forcedLandscape = false;
      await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
      // Hand rotation back to the sensor once upright, so turning the phone works again.
      Future.delayed(const Duration(milliseconds: 900), () {
        if (mounted && !_forcedLandscape) SystemChrome.setPreferredOrientations(DeviceOrientation.values);
      });
    } else {
      _forcedLandscape = true;
      await SystemChrome.setPreferredOrientations([DeviceOrientation.landscapeLeft, DeviceOrientation.landscapeRight]);
    }
  }

  Future<void> _restoreSystemChrome() async {
    await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp, DeviceOrientation.portraitDown]);
    await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  }

  void _openMenu(_Menu menu, {required bool landscape}) {
    _hideTimer?.cancel();
    if (landscape) {
      setState(() {
        _menu = _menu == menu ? _Menu.none : menu;
        _controlsVisible = true;
      });
      return;
    }
    // Upright, a side panel would be squeezed into the 16:9 box — a bottom sheet instead.
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: AppColors.bgElevated,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.xl))),
      builder: (sheetContext) => ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(sheetContext).height * 0.7),
        child: StatefulBuilder(
          builder: (context, setSheetState) => Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 14, 8, 6),
                child: Row(
                  children: [
                    Expanded(child: Text(_menuTitle(menu), style: AppTheme.display(fontSize: 20))),
                    IconButton(
                      tooltip: 'Close',
                      icon: const Icon(Icons.close, color: AppColors.textSecondary),
                      onPressed: () => Navigator.of(sheetContext).pop(),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1, color: AppColors.divider),
              Flexible(
                child: ListView(
                  shrinkWrap: true,
                  padding: const EdgeInsets.all(8),
                  children: _menuRows(menu, onDone: () => Navigator.of(sheetContext).pop()),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _closeMenus() {
    setState(() => _menu = _Menu.none);
    if (_playing) {
      _scheduleHide();
    } else {
      _hideTimer?.cancel();
      setState(() => _controlsVisible = true);
    }
  }

  String get _sourceName => widget.sources.where((s) => s.id == widget.sourceId).firstOrNull?.name ?? 'Source';

  String _menuTitle(_Menu menu) => switch (menu) {
        _Menu.subtitles => 'Subtitles',
        _Menu.audio => 'Audio',
        _Menu.speed => 'Speed',
        _Menu.episodes => 'Episodes',
        _Menu.sources => 'Play from',
        _Menu.none => '',
      };

  void _back() {
    if (_forcedLandscape) {
      _toggleFullscreen();
      return;
    }
    if (context.canPop()) {
      context.pop();
    } else {
      context.go(video.backHref);
    }
  }

  // ===============================================================================================
  // Build

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    // Desktop/TV are always "landscape" for layout purposes.
    final landscape = !_isPhone || size.width > size.height;
    if (_isPhone && _lastLaidOutLandscape == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _syncSystemUiToOrientation());
    }

    final stage = _stage(landscape: landscape);

    return PopScope(
      // TV: back first hides the chrome. Phone: back first leaves a forced full screen.
      canPop: !(isAndroidTv && _controlsVisible) && !_forcedLandscape,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) return;
        if (isAndroidTv && _controlsVisible) {
          setState(() => _controlsVisible = false);
        } else if (_forcedLandscape) {
          _toggleFullscreen();
        }
      },
      child: Focus(
        focusNode: _sync?.tvChromeFocusNode,
        autofocus: true,
        onKeyEvent: (node, event) {
          // Holding ↑/↓ keeps stepping the volume, as holding a key does in any desktop player.
          if (_isDesktop && _menu == _Menu.none && (event is KeyDownEvent || event is KeyRepeatEvent)) {
            if (event.logicalKey == LogicalKeyboardKey.arrowUp) {
              _nudgeVolume(1);
              return KeyEventResult.handled;
            }
            if (event.logicalKey == LogicalKeyboardKey.arrowDown) {
              _nudgeVolume(-1);
              return KeyEventResult.handled;
            }
          }
          if (event is! KeyDownEvent) return KeyEventResult.ignored;
          if (_isDesktop && event.logicalKey == LogicalKeyboardKey.keyM) {
            _toggleMute();
            return KeyEventResult.handled;
          }
          if (_isDesktop && event.logicalKey == LogicalKeyboardKey.keyF) {
            _toggleFullscreen();
            return KeyEventResult.handled;
          }
          if (isAndroidTv && !_controlsVisible) {
            _showControls();
            return KeyEventResult.handled;
          }
          if (event.logicalKey == LogicalKeyboardKey.space) {
            _togglePlay();
            return KeyEventResult.handled;
          }
          if (event.logicalKey == LogicalKeyboardKey.arrowLeft && !isAndroidTv) {
            _skip(-_skipSeconds);
            return KeyEventResult.handled;
          }
          if (event.logicalKey == LogicalKeyboardKey.arrowRight && !isAndroidTv) {
            _skip(_skipSeconds);
            return KeyEventResult.handled;
          }
          if (event.logicalKey == LogicalKeyboardKey.escape && _isFullscreen) {
            _toggleFullscreen();
            return KeyEventResult.handled;
          }
          return KeyEventResult.ignored;
        },
        child: landscape ? ColoredBox(color: Colors.black, child: stage) : _portrait(stage),
      ),
    );
  }

  /// Upright phone: the video on top, the title, actions and episode list underneath — as the
  /// approved portrait player.
  Widget _portrait(Widget stage) {
    final gutter = AppLayout.gutter(MediaQuery.sizeOf(context).width);
    final meta = MediaMeta.parse(video.title);
    final realAudio = _tracks.audio.where((t) => t.id != 'auto' && t.id != 'no').length;
    final hasSubtitles = widget.features.captions && (_subtitles.isNotEmpty || _tracks.subtitle.length > 2);
    final sync = _sync;

    return ColoredBox(
      color: AppColors.background,
      child: Column(
        children: [
          Container(color: Colors.black, height: MediaQuery.paddingOf(context).top),
          AspectRatio(aspectRatio: 16 / 9, child: ColoredBox(color: Colors.black, child: stage)),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.only(bottom: 24),
              children: [
                Padding(
                  padding: EdgeInsets.fromLTRB(gutter, 14, gutter, 0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        meta.title,
                        style: const TextStyle(color: AppColors.foreground, fontSize: 17, fontWeight: FontWeight.w700),
                      ),
                      if (meta.hasAny)
                        Padding(
                          padding: const EdgeInsets.only(top: 3),
                          child: Text(meta.line, style: const TextStyle(color: AppColors.textTertiary, fontSize: 12)),
                        ),
                      if (video.languages case final languages? when languages.parts.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: TitleLanguagesLine(languages: languages, fontSize: 12),
                        ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(6, 12, 6, 4),
                  child: Row(
                    children: [
                      _ActionTile(
                        icon: Icons.groups_outlined,
                        label: sync != null && sync.memberCount > 0 ? '${sync.memberCount} in party' : 'Watch party',
                        highlighted: sync != null && sync.memberCount > 0,
                        badge: sync?.unreadChat ?? 0,
                        onTap: sync?.openPartyUi,
                      ),
                      _ActionTile(
                        icon: Icons.closed_caption_outlined,
                        label: 'Subtitles',
                        onTap: hasSubtitles ? () => _openMenu(_Menu.subtitles, landscape: false) : null,
                      ),
                      _ActionTile(
                        icon: Icons.record_voice_over_outlined,
                        label: 'Audio',
                        onTap: realAudio > 1 ? () => _openMenu(_Menu.audio, landscape: false) : null,
                      ),
                      if (_canSwitchSource)
                        _ActionTile(
                          icon: Icons.swap_horiz,
                          label: _sourceName,
                          onTap: () => _openMenu(_Menu.sources, landscape: false),
                        ),
                      _ActionTile(icon: Icons.fullscreen, label: 'Full screen', onTap: _toggleFullscreen),
                    ],
                  ),
                ),
                // A film's own opinion; an episode's series has its own on the series page.
                if (video.episode == null && video.meta.tmdb != null)
                  Padding(
                    padding: EdgeInsets.fromLTRB(gutter, 10, gutter, 0),
                    child: OpinionButtons(type: video.meta.tmdb!.type, id: video.meta.tmdb!.id),
                  ),
                if (video.episodes.isNotEmpty) ...[
                  Padding(
                    padding: EdgeInsets.fromLTRB(gutter, 18, gutter, 6),
                    child: const Text(
                      'EPISODES',
                      style: TextStyle(
                        color: AppColors.textTertiary,
                        fontSize: 10.5,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 1.3,
                      ),
                    ),
                  ),
                  for (var i = 0; i < video.episodes.length; i++)
                    EpisodeListRow(
                      number: i + 1,
                      episode: video.episodes[i],
                      progress: video.progressByFileId[video.episodes[i].id],
                      current: video.episodes[i].id == video.fileId,
                      gutter: gutter,
                      onTap: () => _navigateToEpisode(video.episodes[i].id),
                    ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// The video plus every overlay on it. [landscape] picks full chrome vs the compact upright set.
  Widget _stage({required bool landscape}) {
    final position = _position;
    final introActive = video.introStart != null &&
        video.introEnd != null &&
        position.inSeconds >= video.introStart! &&
        position.inSeconds < video.introEnd!;
    // An older backend sends no up-next: its credits still get the plain "Next episode" pill.
    final showNext = video.upNext == null &&
        video.outroStart != null &&
        position.inSeconds >= video.outroStart! &&
        video.nextFileId != null;
    final upNext = video.upNext;

    final gestures = GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: _isDesktop
          ? null
          : () {
              if (_menu != _Menu.none) {
                _closeMenus();
              } else if (_controlsVisible && _playing) {
                setState(() => _controlsVisible = false);
              } else {
                _showControls();
              }
            },
      onTapUp: _isDesktop ? (details) => _onDesktopClick(details.localPosition) : null,
      onDoubleTapDown: _isDesktop ? null : (details) => _doubleTapLocalPosition = details.localPosition,
      onDoubleTap: _isDesktop ? null : _handleDoubleTap,
      onVerticalDragStart: _isPhone && landscape ? _handleVerticalDragStart : null,
      onVerticalDragUpdate: _isPhone && landscape ? _handleVerticalDragUpdate : null,
      onVerticalDragEnd: _isPhone && landscape ? _handleVerticalDragEnd : null,
      child: Stack(
        fit: StackFit.expand,
        children: [
          Video(controller: _controller, controls: NoVideoControls, fit: BoxFit.contain),

          // Dim scrim behind the chrome — one gradient for top and bottom, as the design.
          IgnorePointer(
            child: AnimatedOpacity(
              opacity: _controlsVisible ? 1 : 0,
              duration: const Duration(milliseconds: 220),
              child: const DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [Color(0x9E000000), Color(0x00000000), Color(0x00000000), Color(0xC7000000)],
                    stops: [0, 0.26, 0.62, 1],
                  ),
                ),
              ),
            ),
          ),

          if (_brightnessOverlay != null) Center(child: _gestureHud(Icons.brightness_6, _brightnessOverlay!)),

          if (_volumeHud != null)
            Positioned(top: landscape ? 72 : 52, left: 0, right: 0, child: Center(child: _volumeBadge(_volumeHud!))),

          if (_seekHud != null)
            Positioned.fill(
              child: IgnorePointer(
                child: Align(
                  alignment: _seekHud!.forward ? const Alignment(0.7, 0) : const Alignment(-0.7, 0),
                  child: _seekBadge(_seekHud!.forward, _seekHud!.seconds),
                ),
              ),
            ),

          if (_errorMessage != null)
            Positioned(
              left: 16,
              right: 16,
              top: landscape ? 72 : 52,
              child: _Notice(text: _errorMessage!, danger: true),
            ),

          if (_hint != null)
            Positioned(left: 16, right: 16, top: landscape ? 72 : 52, child: Center(child: _Notice(text: _hint!))),

          if (introActive)
            Positioned(
              right: 16,
              bottom: landscape ? 128 : 64,
              child: _pillButton('Skip intro', () {
                if (video.introEnd != null) _userSeekTo(video.introEnd!);
              }),
            ),
          if (showNext)
            Positioned(right: 16, bottom: landscape ? 128 : 64, child: _pillButton('Next episode', () => _goToNext())),

          _chrome(landscape: landscape),

          // Above the chrome, so its buttons win over the scrubber's hit area.
          if (upNext != null && _upNextShown && !_endScreen)
            Positioned(
              right: 16,
              bottom: landscape ? 128 : 64,
              child: UpNextCard(
                item: upNext,
                secondsLeft: _upNextLeft,
                totalSeconds: upNextCountdownSeconds(upNext),
                askStillWatching: _needsStillWatching,
                autoplay: _autoplay,
                onAutoplayChanged: _setAutoplay,
                onPlay: () => _playChosen(upNext),
                onDismiss: _dismissUpNext,
                compact: !landscape,
              ),
            ),

          if (_endScreen)
            Positioned.fill(
              child: UpNextEndScreen(
                upNext: upNext,
                suggestions: video.suggestions,
                askStillWatching: _needsStillWatching && !_upNextDismissed,
                onPlay: _playChosen,
                onReplay: _watchAgain,
                onBack: _leavePlayer,
                compact: !landscape,
              ),
            ),

          // Buffering sits above the chrome's play button so it reads as "loading", not a dead button.
          if (_isBuffering) const Center(child: _Spinner()),

          if (landscape && _menu != _Menu.none)
            _menu == _Menu.episodes
                ? EpisodesPanel(
                    episodes: video.episodes,
                    progressByFileId: video.progressByFileId,
                    currentFileId: video.fileId,
                    onSelect: _navigateToEpisode,
                    onClose: _closeMenus,
                  )
                : _sidePanel(_menuTitle(_menu), _menuRows(_menu, onDone: _closeMenus)),
        ],
      ),
    );

    if (!_isDesktop) return gestures;
    // Desktop: moving the mouse brings the controls up, the cursor hides along with them once
    // they fade (as in any desktop player), and the wheel is the volume.
    return MouseRegion(
      cursor: _controlsVisible || !_playing || _menu != _Menu.none ? MouseCursor.defer : SystemMouseCursors.none,
      onHover: _onDesktopHover,
      child: Listener(onPointerSignal: _onDesktopScroll, child: gestures),
    );
  }

  Widget _volumeBadge(double value) {
    final boosted = value > 100;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
      decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.75), borderRadius: BorderRadius.circular(10)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(value == 0 ? Icons.volume_off : Icons.volume_up, color: boosted ? AppColors.amber : Colors.white, size: 20),
          const SizedBox(width: 10),
          SizedBox(
            width: 110,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(2),
              child: LinearProgressIndicator(
                value: value / PlayerVolumeControl.max,
                minHeight: 4,
                backgroundColor: Colors.white24,
                valueColor: AlwaysStoppedAnimation(boosted ? AppColors.amber : Colors.white),
              ),
            ),
          ),
          const SizedBox(width: 10),
          Text(
            boosted ? '${value.round()}% boost' : '${value.round()}%',
            style: TextStyle(
              color: boosted ? AppColors.amber : Colors.white,
              fontSize: 13,
              fontWeight: FontWeight.w600,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }

  Widget _seekBadge(bool forward, int seconds) {
    return Container(
      width: 92,
      height: 92,
      decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.55), shape: BoxShape.circle),
      alignment: Alignment.center,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(forward ? Icons.fast_forward_rounded : Icons.fast_rewind_rounded, color: Colors.white, size: 28),
          const SizedBox(height: 2),
          Text(
            '${forward ? '+' : '−'}$seconds s',
            style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }

  Widget _chrome({required bool landscape}) {
    final meta = MediaMeta.parse(video.title);
    final sync = _sync;
    final realAudio = _tracks.audio.where((t) => t.id != 'auto' && t.id != 'no').length;
    final hasSubtitles = widget.features.captions && (_subtitles.isNotEmpty || _tracks.subtitle.length > 2);
    return PlayerChrome(
      visible: _controlsVisible,
      landscape: landscape,
      title: meta.title,
      metaLine: meta.hasAny ? meta.line : null,
      playing: _playing,
      locked: _locked,
      position: _position,
      buffered: _buffered,
      duration: _effectiveDuration,
      scrubSeconds: _scrubSeconds,
      ticks: [?video.introStart, ?video.introEnd, ?video.outroStart],
      scrubPreview: _trickplay == null
          ? null
          : (seconds) => TrickplayPreview(
                fileId: video.fileId,
                manifest: _trickplay!,
                seconds: seconds,
                headers: _trickplayHeaders,
              ),
      subtitleLabel: hasSubtitles ? _subtitleLabel() : null,
      audioLabel: realAudio > 1 ? _audioLabel() : null,
      speedLabel: '${_speed == _speed.roundToDouble() ? _speed.toStringAsFixed(0) : _speed}×',
      sourceLabel: _canSwitchSource ? _sourceName : null,
      onSources: _canSwitchSource ? () => _openMenu(_Menu.sources, landscape: landscape) : null,
      hasEpisodes: video.episodes.isNotEmpty,
      hasNext: video.nextFileId != null,
      showPip: _isPhone && landscape,
      showFullscreen: Platform.isWindows || _isPhone,
      fullscreenActive: Platform.isWindows ? _isFullscreen : landscape,
      party: sync == null || isAndroidTv
          ? null
          : PlayerPartyChip(
              members: sync.memberCount,
              unread: sync.unreadChat,
              locked: _locked,
              onTap: sync.openPartyUi,
            ),
      onBack: _back,
      onTogglePlay: _togglePlay,
      onSkipBack: () => _skip(-_skipSeconds),
      onSkipForward: () => _skip(_skipSeconds),
      onScrubStart: (s) {
        _hideTimer?.cancel();
        setState(() => _scrubSeconds = s);
      },
      onScrubUpdate: (s) => setState(() => _scrubSeconds = s),
      onScrubEnd: (s) {
        _userSeekTo(s);
        setState(() => _scrubSeconds = null);
        _showControls();
      },
      onScrubCancel: () {
        if (_scrubSeconds != null) setState(() => _scrubSeconds = null);
        _scheduleHide();
      },
      onLockedTap: _blockIfLocked,
      onSubtitles: () => _openMenu(_Menu.subtitles, landscape: landscape),
      onAudio: () => _openMenu(_Menu.audio, landscape: landscape),
      onSpeed: () => _openMenu(_Menu.speed, landscape: landscape),
      onEpisodes: () => _openMenu(_Menu.episodes, landscape: landscape),
      onNext: () => _goToNext(),
      onPip: PipService.enterNow,
      onFullscreen: _toggleFullscreen,
      volume: _isDesktop ? _volume : null,
      muted: _muted,
      onVolume: _isDesktop ? (v) => _setVolume(v, showHud: false) : null,
      onToggleMute: _isDesktop ? _toggleMute : null,
    );
  }

  List<Widget> _menuRows(_Menu menu, {required VoidCallback onDone}) {
    switch (menu) {
      case _Menu.subtitles:
        final embedded = _tracks.subtitle.where((t) => t.id != 'auto' && t.id != 'no').toList();
        return [
          _trackRow(
            label: 'Off',
            selected: _selectedSubtitleTrack.id == 'no',
            onTap: () {
              _startSubtitlePending = false;
              _selectSubtitle(SubtitleTrack.no(), source: 'off');
              _saveProgress(force: true);
              _announce(PartyStateKind.action);
              onDone();
            },
          ),
          for (final s in _subtitles)
            _trackRow(
              label: _languageName(s.language) ?? s.title ?? 'Track ${s.index}',
              detail: [?s.title, 'Uploaded'].join(' · '),
              selected: _selectedSubtitleTrack.data && _subtitlePreferenceIndex == s.index,
              onTap: () {
                _startSubtitlePending = false;
                _selectSubtitle(SubtitleTrack.data(s.vtt, title: s.title, language: s.language), source: 'external', external: s);
                _saveProgress(force: true);
                _announce(PartyStateKind.action);
                onDone();
              },
            ),
          for (final t in embedded)
            if (_viewerSubtitle(t.id) case final named?)
              // The backend's label already says what the file's own title would add.
              _trackRow(
                label: named.label,
                detail: [if (named.forced) 'Forced', 'In the file'].join(' · '),
                selected: !_selectedSubtitleTrack.data && _selectedSubtitleTrack.id == t.id,
                onTap: () => _pickEmbeddedSubtitle(t, onDone),
              )
            else
              _trackRow(
                label: _languageName(t.language) ?? t.title ?? 'Track ${t.id}',
                detail: [?t.title, 'In the file'].join(' · '),
                selected: !_selectedSubtitleTrack.data && _selectedSubtitleTrack.id == t.id,
                onTap: () => _pickEmbeddedSubtitle(t, onDone),
              ),
        ];
      case _Menu.audio:
        final real = _tracks.audio.where((t) => t.id != 'no').toList();
        return [
          for (final t in real)
            _trackRow(
              label: t.id == 'auto' ? 'Default' : _audioRowLabel(t),
              detail: t.id == 'auto' ? 'Whichever track the file marks as default' : _audioRowDetail(t),
              selected: _track.audio.id == t.id,
              onTap: () {
                _startAudioPending = false;
                _player.setAudioTrack(t);
                _hasAudioPreference = t.id != 'auto';
                _audioPreferenceLanguage = t.id == 'auto' ? null : t.language;
                _audioSaveLanguage = t.id == 'auto' ? null : (_viewerAudio(t.id)?.language ?? t.language);
                _audioPreferenceTitle = t.id == 'auto' ? null : t.title;
                _saveProgress(force: true);
                // The track change lands asynchronously; announce what was picked, not _track.
                final sync = _sync;
                if (sync != null && _syncEnabled && sync.canControl) {
                  final state = _partyState(PartyStateKind.action);
                  final picked = PartyPlaybackState(
                    kind: state.kind,
                    playing: state.playing,
                    positionSeconds: state.positionSeconds,
                    playbackRate: state.playbackRate,
                    serverTimeMs: state.serverTimeMs,
                    fileId: state.fileId,
                    audio: t.id == 'auto'
                        ? const PartyTrackChoice(id: 'auto')
                        : PartyTrackChoice(id: t.id, language: t.language, title: t.title),
                    subtitle: state.subtitle,
                  );
                  _engine.accept(picked);
                  _appliedPartyAudio = picked.audio;
                  _partyTarget = picked;
                  sync.announce(picked);
                }
                onDone();
              },
            ),
        ];
      case _Menu.speed:
        return [
          for (final s in _speedOptions)
            _trackRow(
              label: s == 1 ? 'Normal' : '$s×',
              selected: _speed == s,
              onTap: () {
                _setSpeed(s);
                onDone();
              },
            ),
        ];
      case _Menu.sources:
        return [
          for (final source in widget.sources)
            _trackRow(
              label: source.name,
              selected: source.id == widget.sourceId,
              onTap: () {
                onDone();
                if (source.id == widget.sourceId) return;
                _saveProgress(force: true);
                widget.onSwitchSource?.call(source.id, _positionSeconds);
              },
            ),
        ];
      case _Menu.episodes:
      case _Menu.none:
        return const [];
    }
  }

  void _pickEmbeddedSubtitle(SubtitleTrack t, VoidCallback onDone) {
    _startSubtitlePending = false;
    _selectSubtitle(t, source: _embeddedSource);
    _saveProgress(force: true);
    _announce(PartyStateKind.action);
    onDone();
  }

  String _audioRowLabel(AudioTrack t) =>
      _viewerAudio(t.id)?.label ?? _languageName(t.language) ?? t.title ?? 'Track ${t.id}';

  String? _audioRowDetail(AudioTrack t) {
    final named = _viewerAudio(t.id);
    // The backend's label is built from the language and channels already; the file's own title
    // is the only thing left that might tell two tracks apart.
    if (named != null) return t.title != null && t.title != named.label ? t.title : null;
    return ([?t.title, ?t.language].where((p) => p != _languageName(t.language)).join(' · ')).ifEmpty;
  }

  Widget _pillButton(String label, VoidCallback onTap) {
    return Material(
      color: const Color(0xD9161412),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadius.pill),
        side: const BorderSide(color: AppColors.dividerStrong),
      ),
      child: InkWell(
        customBorder: const StadiumBorder(),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          child: Text(label, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 13)),
        ),
      ),
    );
  }

  Widget _gestureHud(IconData icon, double value) {
    return Container(
      width: 120,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.75), borderRadius: BorderRadius.circular(10)),
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
              valueColor: const AlwaysStoppedAnimation(AppColors.accent),
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
          Expanded(child: GestureDetector(onTap: _closeMenus, child: Container(color: Colors.black54))),
          Container(
            width: 300,
            decoration: const BoxDecoration(
              color: AppColors.bgElevated,
              border: Border(left: BorderSide(color: AppColors.dividerStrong)),
            ),
            child: SafeArea(
              left: false,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 10, 4, 6),
                    child: Row(
                      children: [
                        Expanded(child: Text(title.toUpperCase(), style: AppTheme.display(fontSize: 20))),
                        IconButton(
                          tooltip: 'Close',
                          icon: const Icon(Icons.close, color: AppColors.textSecondary),
                          onPressed: _closeMenus,
                        ),
                      ],
                    ),
                  ),
                  const Divider(height: 1, color: AppColors.divider),
                  Expanded(
                    child: ListView(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8), children: children),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _trackRow({required String label, String? detail, required bool selected, required VoidCallback onTap}) {
    return TvFocusable(
      autofocus: selected,
      borderRadius: BorderRadius.circular(AppRadius.sm),
      onTap: onTap,
      child: Semantics(
        button: true,
        selected: selected,
        label: label,
        excludeSemantics: true,
        child: Container(
          constraints: const BoxConstraints(minHeight: 50),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          decoration: BoxDecoration(
            color: selected ? AppColors.accentSoft : Colors.transparent,
            borderRadius: BorderRadius.circular(AppRadius.sm),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      label,
                      style: TextStyle(
                        color: selected ? AppColors.foreground : AppColors.textSecondary,
                        fontSize: 14,
                        fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                      ),
                    ),
                    if (detail != null && detail.isNotEmpty)
                      Text(detail, style: const TextStyle(color: AppColors.textTertiary, fontSize: 11.5)),
                  ],
                ),
              ),
              if (selected) const Icon(Icons.check, size: 18, color: AppColors.accent),
            ],
          ),
        ),
      ),
    );
  }

  // ===============================================================================================
  // Brightness / volume swipes (landscape phone)

  static const _dragFullRangePixels = 250.0;

  void _handleVerticalDragStart(DragStartDetails details) {
    final width = context.size?.width ?? MediaQuery.sizeOf(context).width;
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
      if (start == null) return;
      final next = (start + fraction).clamp(0.0, 1.0);
      ScreenBrightness().setApplicationScreenBrightness(next).catchError((_) {});
      setState(() => _brightnessOverlay = next);
      _scheduleHideOverlay();
    } else if (_dragIsLeftSide == false) {
      final start = _dragStartVolume;
      if (start == null) return;
      VolumeController.instance.setVolume((start + fraction).clamp(0.0, 1.0));
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
}

extension on String {
  String? get ifEmpty => isEmpty ? null : this;
}

// =================================================================================================
// Chrome pieces

class _Spinner extends StatelessWidget {
  const _Spinner();

  @override
  Widget build(BuildContext context) {
    return const SizedBox(
      width: 44,
      height: 44,
      child: CircularProgressIndicator(strokeWidth: 3, color: AppColors.accent),
    );
  }
}

class _Notice extends StatelessWidget {
  final String text;
  final bool danger;
  const _Notice({required this.text, this.danger = false});

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(maxWidth: 520),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: danger ? const Color(0xE65A1F1C) : const Color(0xE6161412),
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: danger ? AppColors.danger : AppColors.dividerStrong),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(danger ? Icons.error_outline : Icons.lock_outline, size: 16, color: danger ? AppColors.danger : AppColors.amber),
          const SizedBox(width: 8),
          Flexible(child: Text(text, style: const TextStyle(color: Colors.white, fontSize: 12.5, height: 1.35))),
        ],
      ),
    );
  }
}

class _ActionTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final bool highlighted;
  final int badge;
  const _ActionTile({required this.icon, required this.label, required this.onTap, this.highlighted = false, this.badge = 0});

  @override
  Widget build(BuildContext context) {
    final color = onTap == null
        ? AppColors.textTertiary.withValues(alpha: 0.5)
        : (highlighted ? AppColors.accent : AppColors.textSecondary);
    return Expanded(
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.md),
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 60),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Stack(
                clipBehavior: Clip.none,
                children: [
                  Icon(icon, color: color, size: 23),
                  if (badge > 0)
                    Positioned(
                      right: -4,
                      top: -3,
                      child: Container(
                        width: 9,
                        height: 9,
                        decoration: const BoxDecoration(color: AppColors.accent, shape: BoxShape.circle),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 6),
              Text(label, style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w600)),
            ],
          ),
        ),
      ),
    );
  }
}
