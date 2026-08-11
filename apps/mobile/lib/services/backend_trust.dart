/// Trusts the backend's self-signed TLS certificate (see scripts/generate-self-signed-cert.sh at
/// the repo root — this app's copy of it lives at assets/certs/backend_cert.pem, kept in sync by
/// that script). Without this, every HTTPS request Dart makes (login, library/folder/video
/// fetches, media-token minting, progress saves) fails with a certificate-trust error — a browser
/// lets you click through a self-signed-cert warning, native Dart networking on
/// Android/iOS/desktop doesn't have an equivalent, it just refuses the connection.
///
/// Only applies to `dart:io`-backed networking (package:http on Android/iOS/desktop). It does
/// NOT cover video_player's native playback (ExoPlayer on Android, AVPlayer on iOS), which uses
/// each platform's own OS networking stack — Android's trust is handled separately via
/// android/app/src/main/res/xml/network_security_config.xml (see apps/mobile/README.md); iOS
/// currently has no equivalent here, so video playback against a self-signed cert will not work
/// on iOS without further platform-specific work.
///
/// A no-op on Flutter Web (which doesn't have `dart:io` at all — the browser handles its own TLS).
library;

export 'backend_trust_stub.dart' if (dart.library.io) 'backend_trust_io.dart';
