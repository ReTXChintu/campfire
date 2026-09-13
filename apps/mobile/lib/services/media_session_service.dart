import 'dart:io';
import 'package:audio_service/audio_service.dart';
import 'package:flutter/foundation.dart';
import 'package:permission_handler/permission_handler.dart';

/// Proxies OS/Bluetooth media-button events into whichever field the currently-attached player has
/// wired up — this handler never touches a player/controller itself, it's purely a relay so
/// audio_service has something to call into.
class CampfireAudioHandler extends BaseAudioHandler {
  VoidCallback? onPlayCb;
  VoidCallback? onPauseCb;
  ValueChanged<Duration>? onSeekCb;
  VoidCallback? onSkipNextCb;
  VoidCallback? onSkipPreviousCb;

  @override
  Future<void> play() async => onPlayCb?.call();

  @override
  Future<void> pause() async => onPauseCb?.call();

  @override
  Future<void> seek(Duration position) async => onSeekCb?.call(position);

  @override
  Future<void> skipToNext() async => onSkipNextCb?.call();

  @override
  Future<void> skipToPrevious() async => onSkipPreviousCb?.call();
}

/// Android only — gives connected Bluetooth earphones/smartwatches (and the lock screen) real
/// "now playing" awareness: a MediaSession with play/pause/skip controls they can trigger from
/// their own hardware buttons, kept in sync with whichever of CampfireVideoPlayer/
/// MediaKitVideoPlayer is actually on screen. All real playback logic stays inside those two
/// widgets — this service only relays state in and control actions out.
class MediaSessionService {
  MediaSessionService._();
  static CampfireAudioHandler? _handler;

  static Future<void> init() async {
    if (!Platform.isAndroid) return;
    // Android 13+ hides the media-session notification (so no lock-screen/Bluetooth controls at
    // all) unless this is granted — a no-op prompt on older Android where it's not required.
    await Permission.notification.request();
    _handler = await AudioService.init(
      builder: () => CampfireAudioHandler(),
      config: const AudioServiceConfig(
        androidNotificationChannelId: 'io.iboon.campfire_mobile.playback',
        androidNotificationChannelName: 'Campfire playback',
        // Ongoing (undismissable while playing) + stop-foreground-on-pause together match how
        // video/podcast apps usually behave: the notification sticks around during playback so
        // Bluetooth/lock-screen controls stay live, but lets go the moment playback pauses instead
        // of pinning a stale notification forever.
        androidNotificationOngoing: true,
        androidStopForegroundOnPause: true,
      ),
    );
  }

  /// Called by the active player's initState (Android only). `onPlay`/`onPause` should be exactly
  /// the branches the player's own `_togglePlay()` already has — call only the missing half — so a
  /// Bluetooth button press can't double-toggle playback.
  static void attach({
    required String title,
    Duration? duration,
    required VoidCallback onPlay,
    required VoidCallback onPause,
    required ValueChanged<Duration> onSeek,
    VoidCallback? onSkipNext,
    VoidCallback? onSkipPrevious,
  }) {
    final handler = _handler;
    if (handler == null) return;
    handler.onPlayCb = onPlay;
    handler.onPauseCb = onPause;
    handler.onSeekCb = onSeek;
    handler.onSkipNextCb = onSkipNext;
    handler.onSkipPreviousCb = onSkipPrevious;
    handler.mediaItem.add(MediaItem(id: title, title: title, duration: duration));
  }

  /// Called from the active player's own position-tick listener whenever local playing/position
  /// state changes, so Bluetooth devices/the lock screen reflect it in near-real-time.
  static void updateState({required bool playing, required Duration position, double speed = 1.0}) {
    final handler = _handler;
    if (handler == null) return;
    handler.playbackState.add(
      PlaybackState(
        controls: [
          if (handler.onSkipPreviousCb != null) MediaControl.skipToPrevious,
          playing ? MediaControl.pause : MediaControl.play,
          if (handler.onSkipNextCb != null) MediaControl.skipToNext,
        ],
        systemActions: const {MediaAction.seek},
        playing: playing,
        updatePosition: position,
        speed: speed,
        processingState: AudioProcessingState.ready,
      ),
    );
  }

  /// Called from the active player's dispose() — clears the session back to idle so a Bluetooth
  /// device doesn't keep offering play/pause for a screen that's gone.
  static void detach() {
    final handler = _handler;
    if (handler == null) return;
    handler.onPlayCb = null;
    handler.onPauseCb = null;
    handler.onSeekCb = null;
    handler.onSkipNextCb = null;
    handler.onSkipPreviousCb = null;
    handler.playbackState.add(PlaybackState(processingState: AudioProcessingState.idle));
  }
}
