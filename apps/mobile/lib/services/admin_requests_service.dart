import '../models/media_request.dart';
import 'api_client.dart';

/// `GET /api/admin/requests` returns the list *and* the counts in one go.
class AdminRequestsPage {
  final List<AdminMediaRequest> requests;
  final RequestCounts counts;
  final int total;

  const AdminRequestsPage({required this.requests, required this.counts, required this.total});

  factory AdminRequestsPage.fromJson(Map<String, dynamic> json) => AdminRequestsPage(
    requests: (json['requests'] as List)
        .map((e) => AdminMediaRequest.fromJson(e as Map<String, dynamic>))
        .toList(),
    counts: RequestCounts.fromJson(json['counts'] as Map<String, dynamic>? ?? const {}),
    total: (json['total'] as num?)?.toInt() ?? 0,
  );
}

/// Desktop-only (see platform_info.dart's isDesktopAdminCapable) — Android never shows admin UI,
/// by product decision. Every call here is also independently enforced server-side by
/// requireAdmin, so this gate is convenience, not the security boundary.
class AdminRequestsService {
  AdminRequestsService._();

  static Future<AdminRequestsPage> fetchAll({RequestStatus? status}) async {
    final query = status != null ? '?status=${status.wire}' : '';
    final data = await ApiClient.get('/api/admin/requests$query') as Map<String, dynamic>;
    return AdminRequestsPage.fromJson(data);
  }

  /// Cheap enough to call just for the top-bar "N new" badge.
  static Future<RequestCounts> fetchCounts() async {
    final data = await ApiClient.get('/api/admin/requests/counts') as Map<String, dynamic>;
    return RequestCounts.fromJson(data['counts'] as Map<String, dynamic>? ?? const {});
  }

  static Future<AdminMediaRequest> fetchOne(String id) async {
    final data = await ApiClient.get('/api/admin/requests/$id') as Map<String, dynamic>;
    return AdminMediaRequest.fromJson(data['request'] as Map<String, dynamic>);
  }

  /// Any subset of the patchable fields. The server enforces "declined needs a note" and "added
  /// needs a catalogRef" and answers with the offending `field`, which the detail panel pins to
  /// the right input — those rules aren't duplicated client-side.
  ///
  /// `clearAdminNote`/`clearCatalogRef` send an explicit null, which is different from omitting
  /// the field (omitted = leave as-is).
  static Future<AdminMediaRequest> update(
    String id, {
    RequestStatus? status,
    String? adminNote,
    bool clearAdminNote = false,
    CatalogRef? catalogRef,
    bool clearCatalogRef = false,
    String? type,
    bool clearType = false,
    int? year,
    bool clearYear = false,
  }) async {
    // Built field by field rather than as one literal: "send an explicit null" and "leave the
    // field out entirely" are different requests to this endpoint, and a collection-if can't say
    // both about the same key.
    final body = <String, dynamic>{};
    if (status != null) body['status'] = status.wire;
    if (clearAdminNote) {
      body['adminNote'] = null;
    } else if (adminNote != null) {
      body['adminNote'] = adminNote;
    }
    if (clearCatalogRef) {
      body['catalogRef'] = null;
    } else if (catalogRef != null) {
      body['catalogRef'] = catalogRef.toJson();
    }
    if (clearType) {
      body['type'] = null;
    } else if (type != null) {
      body['type'] = type;
    }
    if (clearYear) {
      body['year'] = null;
    } else if (year != null) {
      body['year'] = year;
    }
    final data = await ApiClient.patch('/api/admin/requests/$id', body) as Map<String, dynamic>;
    return AdminMediaRequest.fromJson(data['request'] as Map<String, dynamic>);
  }

  /// Multi-select status change. The server refuses `declined` and `added` here — both need a
  /// per-request note or catalog link — so the UI only offers the other three.
  static Future<RequestCounts> bulkStatus(List<String> ids, RequestStatus status) async {
    final data = await ApiClient.post('/api/admin/requests/bulk-status', {
      'ids': ids,
      'status': status.wire,
    }) as Map<String, dynamic>;
    return RequestCounts.fromJson(data['counts'] as Map<String, dynamic>? ?? const {});
  }

  static Future<void> remove(String id) => ApiClient.delete('/api/admin/requests/$id');
}
