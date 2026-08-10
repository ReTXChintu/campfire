# Campfire (mobile)

Flutter client for Campfire — same dark theme, same backend (`apps/backend`) as the web app (`apps/frontend`). **No admin screens exist in this app at all** — curating/publishing/converting only happens on the web.

## Setup

### 1. Backend

You need a running `apps/backend` (see the root README) reachable from wherever you run the app.

### 2. Google Sign-In

The mobile app signs in natively (no browser redirect) and exchanges the resulting Google ID token for a session JWT via `POST /auth/google/mobile` on the backend. This needs its own OAuth client per platform, from the **same Google Cloud project** as the web OAuth client:

- **Android**: Google Cloud Console → Credentials → Create Credentials → OAuth client ID → Android. You'll need your debug/release keystore's SHA-1 fingerprint (`keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android` for the debug keystore) and the package name (`io.iboon.campfire_mobile`, from `android/app/build.gradle.kts`'s `applicationId`).
- **iOS**: Credentials → Create Credentials → OAuth client ID → iOS, using the bundle id from `ios/Runner.xcodeproj` (`io.iboon.campfireMobile` by default — check `PRODUCT_BUNDLE_IDENTIFIER`). Add the resulting reversed-client-id URL scheme to `ios/Runner/Info.plist` (see the [google_sign_in package docs](https://pub.dev/packages/google_sign_in) for the exact `CFBundleURLTypes` entry).

Once created, set both client IDs on the backend (`apps/backend/.env`):

```
GOOGLE_ANDROID_CLIENT_ID=
GOOGLE_IOS_CLIENT_ID=
```

Without these, sign-in on a real device will fail ID-token verification — the app itself doesn't need any client ID configured locally beyond the platform files above (`google-services.json`/`GoogleService-Info.plist` aren't required for `google_sign_in`'s classic v6 API, only for Firebase-specific features this app doesn't use).

### 3. Run

```bash
flutter pub get
flutter run --dart-define=API_URL=http://localhost:4000
```

On an Android emulator specifically, `localhost` refers to the emulator itself, not your host machine — use `http://10.0.2.2:4000` instead. Physical devices need your machine's LAN IP.

Skip real Google Sign-In during development with a pre-minted JWT (signed with the backend's `AUTH_JWT_SECRET`):

```bash
flutter run --dart-define=API_URL=http://localhost:4000 --dart-define=DEBUG_TOKEN=<jwt>
```

(Debug builds only — compiled out of release builds entirely.)

## Design parity with the web app

`lib/theme/app_theme.dart` mirrors `apps/frontend/src/index.css`'s color tokens and fonts (Bebas Neue / Inter / JetBrains Mono via `google_fonts`) by hand — there's no shared theme package between the two apps (same call as the frontend/backend split not sharing a `packages/` workspace: small enough to duplicate, not worth the tooling).

## Known simplifications vs. the web player

- **Restart-mode (MKV) subtitles aren't supported.** The web player streams a live, seek-position-dependent WebVTT fetch for MKV content — the backend's own code comments note a full-track extraction can take minutes on a large file, which is why it's seek-dependent in the first place. Native-mode subtitles (anything that's been through the admin Converter — the common case) work fully, parsed client-side from the already-fetched VTT text since `video_player` has no built-in text-track rendering.
- Audio-delay / subtitle-delay fine-tuning sliders (present in the web player's restart-mode track settings) aren't implemented here — only audio-track selection.
