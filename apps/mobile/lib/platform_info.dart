import 'dart:io' show Platform;
import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart' show kIsWeb;

/// The admin panel is Windows-only by product decision, not technical necessity — curation stays
/// desktop-only, same "no admin on phones" reasoning that already applied when this was
/// Android/iOS-only. See app_router.dart's redirect and top_bar.dart's menu entry.
bool get isDesktopAdminCapable => !kIsWeb && Platform.isWindows;

/// video_player (CampfireVideoPlayer's engine) has NO Windows implementation at all — only
/// video_player_android, video_player_avfoundation (iOS/macOS), and video_player_web exist, no
/// video_player_windows. So on Windows, every video — not just MKV — has to go through the
/// media_kit-backed player (widgets/media_kit_video_player.dart) instead; CampfireVideoPlayer would
/// silently fail to initialize there (caught, swallowed, dead black screen, no error). Elsewhere
/// (Android/iOS), video_player works fine for native/restart-mode content, so only MKV needs
/// media_kit — see [supportsMkvPlayback].
bool get requiresMediaKitPlayer => !kIsWeb && Platform.isWindows;

/// MKV titles get the real libmpv-backed player on Windows and Android (see seekMode: "raw" from
/// the backend) — everywhere else (iOS, web) falls back to the same "get the app" messaging web
/// itself shows, since neither platform has a working native-MKV player wired up here.
bool get supportsMkvPlayback => !kIsWeb && (Platform.isWindows || Platform.isAndroid);

/// Windows gets a docked side panel that narrows the video instead of a modal bottom sheet
/// overlaid on top of it — see design.html's desktop/web layout, mirrored in
/// widgets/watch_party_overlay.dart. Phone keeps the collapsible peek-pill presentation; TV gets
/// its own docked rail (see [isAndroidTv]).
bool get usesDockedPartyPanel => !kIsWeb && Platform.isWindows;

// Resolved once at startup by [initAndroidTvDetection] (called from main.dart before runApp) —
// Android TV can't be told apart from a phone/tablet by Platform.isAndroid alone, and the actual
// check (systemFeatures) is async, so every other call site just reads this cached bool instead of
// threading a Future through the widget tree.
bool _isAndroidTv = false;

/// True on an Android TV device (checked via the same `android.software.leanback` system feature
/// AndroidManifest.xml's LEANBACK_LAUNCHER intent filter declares support for) — false everywhere
/// else, including phones/tablets and before [initAndroidTvDetection] has run.
bool get isAndroidTv => _isAndroidTv;

/// Populates [isAndroidTv]. Safe to call on every platform (no-ops instantly off-Android); must
/// finish before the first frame that might branch on [isAndroidTv] (see main.dart).
Future<void> initAndroidTvDetection() async {
  if (kIsWeb || !Platform.isAndroid) return;
  try {
    final info = await DeviceInfoPlugin().androidInfo;
    _isAndroidTv = info.systemFeatures.contains('android.software.leanback');
  } catch (_) {
    // Best-effort — stays false (treated as a phone) if the platform channel call fails.
  }
}
