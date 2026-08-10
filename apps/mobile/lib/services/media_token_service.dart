import 'api_client.dart';

/// Mints a scoped, short-lived media token for one fileId — same backend endpoint the web app
/// uses (see apps/backend/src/routes/media-token.ts). Native platforms' video_player
/// (ExoPlayer/AVPlayer) *can* attach a normal Bearer header to a video request, but Flutter Web's
/// video_player_web ultimately loads a plain HTML `<video src>`, which — like the browser
/// `<video>` tag the React web app is built on — can't carry custom headers at all. Using the
/// query-token approach everywhere (not just on web) keeps one code path instead of branching
/// behavior per platform.
class MediaTokenService {
  MediaTokenService._();

  static Future<String> mint(String fileId) async {
    final data = await ApiClient.get('/api/media-token?fileId=${Uri.encodeQueryComponent(fileId)}')
        as Map<String, dynamic>;
    return data['token'] as String;
  }
}
