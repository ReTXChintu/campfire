/// Backend base URL — baked in at build time via `--dart-define=API_URL=...` (mirrors the
/// frontend's VITE_API_URL). Defaults to localhost for `flutter run` during development.
///
/// Note for local dev on an Android emulator specifically: the emulator's own loopback address is
/// `10.0.2.2`, not `localhost` — pass `--dart-define=API_URL=http://10.0.2.2:4000` when running
/// against a backend on your host machine. iOS simulators and physical devices don't have this
/// quirk (simulators share the host's localhost; physical devices need your machine's LAN IP).
const apiBaseUrl = String.fromEnvironment('API_URL', defaultValue: 'http://localhost:4000');

/// Web frontend base URL — baked in at build time via `--dart-define=WEB_URL=...`. Only needed for
/// the TV pairing-login QR code (screens/tv_pairing_login_screen.dart), which points a scanning
/// phone at the web app's `/link?code=...` claim page; nothing else in this app needs to know the
/// web frontend's own URL. Defaults to Vite's local dev server port.
const webBaseUrl = String.fromEnvironment('WEB_URL', defaultValue: 'http://localhost:5173');

/// App version — baked in at build time via `--dart-define=APP_VERSION=...` (the CI workflow reads
/// this from pubspec.yaml, the single source of truth `npm run release` keeps in sync across all
/// three apps). Defaults to "dev" for a local `flutter run`, so a dev build is never mistaken for a
/// real release when checking which build you're on.
const appVersion = String.fromEnvironment('APP_VERSION', defaultValue: 'dev');
