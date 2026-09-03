import 'dart:io' show Platform;
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
