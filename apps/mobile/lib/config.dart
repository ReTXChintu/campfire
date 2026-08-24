/// Backend base URL — baked in at build time via `--dart-define=API_URL=...` (mirrors the
/// frontend's VITE_API_URL). Defaults to localhost for `flutter run` during development.
///
/// Note for local dev on an Android emulator specifically: the emulator's own loopback address is
/// `10.0.2.2`, not `localhost` — pass `--dart-define=API_URL=http://10.0.2.2:4000` when running
/// against a backend on your host machine. iOS simulators and physical devices don't have this
/// quirk (simulators share the host's localhost; physical devices need your machine's LAN IP).
// const apiBaseUrl = String.fromEnvironment('API_URL', defaultValue: 'http://192.168.29.23:4000');
const apiBaseUrl = String.fromEnvironment('API_URL', defaultValue: 'https://187.127.179.114:50001');
