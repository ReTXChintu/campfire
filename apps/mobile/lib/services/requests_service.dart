import '../models/media_request.dart';
import 'api_client.dart';

/// The viewer-facing half of the requests API (`/api/requests`) — available on every platform,
/// unlike admin_requests_service.dart. Mirrors the endpoint surface apps/frontend's requests
/// hooks call; see apps/backend/src/routes/requests.ts.
class RequestsService {
  RequestsService._();

  /// The whole board — everyone's requests. That's what makes "N people want this" mean anything.
  static Future<List<MediaRequest>> fetchAll() async {
    final data = await ApiClient.get('/api/requests') as Map<String, dynamic>;
    return _requests(data);
  }

  static Future<List<MediaRequest>> fetchMine() async {
    final data = await ApiClient.get('/api/requests/mine') as Map<String, dynamic>;
    return _requests(data);
  }

  /// The form's dedupe hint. Returns the single best open match, or null (always null under two
  /// characters, server-side — no need to pre-check here beyond saving the round trip).
  static Future<MediaRequest?> match(String title) async {
    if (title.trim().length < 2) return null;
    final data =
        await ApiClient.get('/api/requests/match?title=${Uri.encodeQueryComponent(title.trim())}')
            as Map<String, dynamic>;
    final match = data['match'];
    return match == null ? null : MediaRequest.fromJson(match as Map<String, dynamic>);
  }

  /// Validates a pasted link. Throws [ApiException] (status 400, `code: "unsupported_link"`) when
  /// it isn't an IMDb/TMDb title link; succeeds with a null `meta` when the link is fine but the
  /// backend has no TMDB key to enrich it with.
  static Future<ResolvedLink> resolveLink(String link) async {
    final data = await ApiClient.post('/api/requests/resolve-link', {'link': link}) as Map<String, dynamic>;
    return ResolvedLink.fromJson(data);
  }

  /// Uploads the reference image first and hands back its id; the create call below references it.
  /// An abandoned form therefore costs one orphaned file, not a half-written request.
  static Future<UploadedReferenceImage> uploadReferenceImage(
    List<int> bytes,
    String contentType,
  ) async {
    final data = await ApiClient.postBytes('/api/requests/reference-image', bytes, contentType)
        as Map<String, dynamic>;
    return UploadedReferenceImage.fromJson(data);
  }

  /// Title + exactly one reference. Server-side validation errors arrive as [ApiException]s
  /// carrying the offending `field` ("title" / "reference" / "refLink" / "refImage").
  static Future<MediaRequest> create({
    required String title,
    String? refLink,
    String? refImageId,
  }) async {
    final data = await ApiClient.post('/api/requests', {
      'title': title,
      if (refLink != null && refLink.isNotEmpty) 'refLink': refLink,
      if (refImageId != null && refImageId.isNotEmpty) 'refImageId': refImageId,
    }) as Map<String, dynamic>;
    return MediaRequest.fromJson(data['request'] as Map<String, dynamic>);
  }

  static Future<MediaRequest> upvote(String id, {required bool wantsIt}) async {
    final data = await ApiClient.post('/api/requests/$id/upvote', {'wantsIt': wantsIt})
        as Map<String, dynamic>;
    return MediaRequest.fromJson(data['request'] as Map<String, dynamic>);
  }

  /// Withdraw your own request while it's still open (the admin can remove any).
  static Future<void> remove(String id) => ApiClient.delete('/api/requests/$id');

  static List<MediaRequest> _requests(Map<String, dynamic> data) => (data['requests'] as List)
      .map((e) => MediaRequest.fromJson(e as Map<String, dynamic>))
      .toList();
}
