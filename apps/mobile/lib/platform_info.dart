import 'dart:io' show Platform;
import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart' show kIsWeb;

/// The admin panel is Windows-only by product decision, not technical necessity — curation stays
/// desktop-only, same "no admin on phones" reasoning that already applied when this was
/// Android/iOS-only. See app_router.dart's redirect and top_bar.dart's menu entry.
bool get isDesktopAdminCapable => !kIsWeb && Platform.isWindows;

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
