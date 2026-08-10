import 'token_store.dart';

/// Unlike the web app, Flutter's `Image.network`/`VideoPlayerController` accept custom HTTP
/// headers directly — a plain HTML `<img>`/`<video>` tag can't, which is why the web client needs
/// a separate scoped media-token workaround (see apps/frontend/src/lib/mediaToken.ts). The mobile
/// app doesn't need that: it just sends the normal Bearer JWT, which every media route on the
/// backend already accepts as a fallback (see apps/backend/src/middleware/mediaAuth.ts).
Future<Map<String, String>> authHeaders() async {
  final token = await TokenStore.read();
  return token != null ? {'Authorization': 'Bearer $token'} : {};
}
