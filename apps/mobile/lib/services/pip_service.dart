import 'dart:io';
import 'package:flutter/services.dart';

/// Android Picture-in-Picture — a minimal hand-written platform channel (not a third-party PiP
/// plugin) calling Android's real `enterPictureInPictureMode()` directly via MainActivity.kt.
class PipService {
  PipService._();
  static const _channel = MethodChannel('campfire/pip');

  /// Explicit button press.
  static Future<void> enterNow() async {
    if (!Platform.isAndroid) return;
    await _channel.invokeMethod('enterPip').catchError((_) {});
  }

  /// Tells the native side whether the current screen is "PiP-eligible" (a video is actively
  /// playing) — read by MainActivity.onUserLeaveHint() to decide whether backgrounding the app
  /// (home button, recents) should auto-enter PiP instead of just going to the background normally.
  static Future<void> setAutoEnterEnabled(bool enabled) async {
    if (!Platform.isAndroid) return;
    await _channel.invokeMethod('setAutoEnterEnabled', {'enabled': enabled}).catchError((_) {});
  }
}
