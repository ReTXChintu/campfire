# Campfire (mobile)

Flutter client for Campfire — same dark theme, same backend (`apps/backend`) as the web app (`apps/frontend`). **No admin screens exist in this app at all** — curating/publishing/converting only happens on the web.

## Setup

### 1. Backend

You need a running `apps/backend` (see the root README) reachable from wherever you run the app.

### 2. Login

No OAuth — plain email/password, with a "Sign up" toggle on the login screen for creating your own account (never grants admin, and this app has no admin UI to grant anyway). One admin account is also seeded into Mongo from `apps/backend/.env`'s `ADMIN_EMAIL`/`ADMIN_PASSWORD` on every backend startup, for signing into the web app's admin pages — see the root README.

### 3. Backend certificate trust (only if the backend uses the self-signed cert)

If your backend is on plain HTTP, or a real (CA-signed) certificate, skip this — it's only needed for the `https://<IP>:<PORT>` self-signed-cert deployment (root README's Option B). A browser lets you click through a self-signed-cert warning; native Android/iOS networking has no equivalent, so without this the app can't reach the backend at all.

Run `./scripts/generate-self-signed-cert.sh <ip>` from the repo root (or re-run it if you already have a cert) — it now also copies the public certificate into this app:

- `apps/mobile/assets/certs/backend_cert.pem` — trusted by `lib/services/backend_trust_io.dart` for all of the app's own API calls (login, library, media-token minting, etc.)
- `apps/mobile/android/app/src/main/res/raw/backend_cert.pem` — trusted via `android/app/src/main/res/xml/network_security_config.xml` for `video_player`'s native playback (ExoPlayer), which doesn't go through Dart's networking at all

**Rebuild the app after regenerating the cert** — both are bundled at build time, not read at runtime.

**iOS limitation**: only the Dart-side trust (API calls, login) is covered on iOS. `video_player`'s native `AVPlayer` uses iOS's own networking stack (App Transport Security), which has no equivalent to Android's `network_security_config` wired up here — video playback against a self-signed cert will not work on iOS without further platform-specific work (a custom `AVAssetResourceLoaderDelegate`, not implemented). If you need iOS support, the real fix is a proper domain + free Let's Encrypt certificate instead of a self-signed one — then none of this section applies on any platform.

### 4. Run

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

### 5. Build a release APK/App Bundle pointed at a real backend

```bash
flutter build apk --release --dart-define=API_URL=https://<server-ip-or-domain>:<port>
# or, for a Play Store upload:
flutter build appbundle --release --dart-define=API_URL=https://<server-ip-or-domain>:<port>
```

Output: `build/app/outputs/flutter-apk/app-release.apk` (or `build/app/outputs/bundle/release/app-release.aab`). Sideload the APK directly, or upload the `.aab` to Play Console. To show a "Get the App" button on the web app linking to wherever you host this file, set `VITE_MOBILE_APP_DOWNLOAD_URL` in `apps/frontend/.env` before rebuilding the frontend.

iOS: `flutter build ipa --release --dart-define=API_URL=...` (needs a Mac + Xcode + an Apple Developer account for signing — not something this environment can build or verify).

## Design parity with the web app

`lib/theme/app_theme.dart` mirrors `apps/frontend/src/index.css`'s color tokens and fonts (Bebas Neue / Inter / JetBrains Mono via `google_fonts`) by hand — there's no shared theme package between the two apps (same call as the frontend/backend split not sharing a `packages/` workspace: small enough to duplicate, not worth the tooling).

## Known simplifications vs. the web player

- **Restart-mode (MKV) subtitles aren't supported.** The web player streams a live, seek-position-dependent WebVTT fetch for MKV content — the backend's own code comments note a full-track extraction can take minutes on a large file, which is why it's seek-dependent in the first place. Native-mode subtitles (anything that's been through the admin Converter — the common case) work fully, parsed client-side from the already-fetched VTT text since `video_player` has no built-in text-track rendering.
- Audio-delay / subtitle-delay fine-tuning sliders (present in the web player's restart-mode track settings) aren't implemented here — only audio-track selection.
