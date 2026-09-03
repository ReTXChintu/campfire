# Campfire (mobile)

Flutter client for Campfire — same dark theme, same backend (`apps/backend`) as the web app (`apps/frontend`). Targets Android and Windows desktop. **Admin screens only exist in the Windows build** (`lib/screens/admin/`, gated by `lib/platform_info.dart`) — the Android build has none, same as before. MKV titles get a real native player (`lib/widgets/mkv_video_player.dart`, via `media_kit`/libmpv) on both platforms — a completely different widget from the MP4 player (`video_player`-based).

## Setup

### 1. Backend

You need a running `apps/backend` (see the root README) reachable from wherever you run the app.

### 2. Login

No OAuth — plain email/password, with a "Sign up" toggle on the login screen for creating your own account (never grants admin, and this app has no admin UI to grant anyway). One admin account is also seeded into Mongo from `apps/backend/.env`'s `ADMIN_EMAIL`/`ADMIN_PASSWORD` on every backend startup, for signing into the web app's admin pages — see the root README.

### 3. Run

```bash
flutter pub get
flutter run --dart-define=API_URL=http://localhost:4000
```

On an Android emulator specifically, `localhost` refers to the emulator itself, not your host machine — use `http://10.0.2.2:4000` instead. Physical devices need your machine's LAN IP (or your server's real IP for a deployed backend).

Skip typing credentials during development with a pre-minted JWT (signed with the backend's `AUTH_JWT_SECRET`):

```bash
flutter run --dart-define=API_URL=http://localhost:4000 --dart-define=DEBUG_TOKEN=<jwt>
```

(Debug builds only — compiled out of release builds entirely.)

### 4. Build a release pointed at a real backend

```bash
flutter build apk --release --dart-define=API_URL=http://<server-ip-or-domain>:<port>
# or, for a Play Store upload:
flutter build appbundle --release --dart-define=API_URL=http://<server-ip-or-domain>:<port>
# Windows desktop (admin panel + MKV playback):
flutter build windows --release --dart-define=API_URL=http://<server-ip-or-domain>:<port>
```

Android output: `build/app/outputs/flutter-apk/app-release.apk` (or `build/app/outputs/bundle/release/app-release.aab`). Sideload the APK directly, or upload the `.aab` to Play Console. Windows output: `build/windows/x64/runner/Release/`. To show "Get the App" / "Desktop App" buttons on the web app linking to wherever you host these, set `VITE_MOBILE_APP_DOWNLOAD_URL` / `VITE_DESKTOP_APP_DOWNLOAD_URL` in `apps/frontend/.env` before rebuilding the frontend.

Both apps only ever speak plain HTTP — if you need TLS, put a reverse proxy in front of the backend and point `API_URL` at that instead (nothing here needs to change either way).

## Design parity with the web app

`lib/theme/app_theme.dart` mirrors `apps/frontend/src/index.css`'s color tokens and fonts (Bebas Neue / Inter / JetBrains Mono via `google_fonts`) by hand — there's no shared theme package between the two apps (same call as the frontend/backend split not sharing a `packages/` workspace: small enough to duplicate, not worth the tooling).

## Two player engines

`lib/widgets/campfire_video_player.dart` (`video_player`) and `lib/widgets/media_kit_video_player.dart` (libmpv via `media_kit`) — `watch_screen.dart` picks between them. **`video_player` has no Windows implementation at all**, so on Windows every video goes through the `media_kit` player regardless of format; elsewhere (Android/iOS) only MKV needs it. See `lib/platform_info.dart`.

## Known simplifications vs. the web player

- **Restart-mode (the ffmpeg-remux fallback for non-native, non-MKV formats) subtitles aren't supported on `CampfireVideoPlayer`.** The web player streams a live, seek-position-dependent WebVTT fetch for that content — the backend's own code comments note a full-track extraction can take minutes on a large file, which is why it's seek-dependent in the first place. Native-mode subtitles (anything that's been through the admin Converter — the common case) work fully, parsed client-side from the already-fetched VTT text since `video_player` has no built-in text-track rendering. `media_kit_video_player.dart` instead offers whatever subtitle/audio tracks are embedded in the container itself (real tracks for MKV; for mp4/restart content, that may not match `video.subtitles`' separately-uploaded set).
- Audio-delay / subtitle-delay fine-tuning sliders (present in the web player's restart-mode track settings) aren't implemented on either mobile player — only audio-track selection.
