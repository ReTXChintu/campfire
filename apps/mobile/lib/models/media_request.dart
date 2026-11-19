// Mirrors apps/backend/src/routes/requests.ts's toPublicRequest() and
// routes/admin/requests.ts's toAdminRequest() — see the requests API contract. A request is
// deliberately only a *title plus one reference* (link OR image): `type`/`year` exist but are
// filled in by the link lookup or the admin, so they're usually null and must never be rendered
// as a "Movie"/"Unknown" placeholder.

/// The fixed status ladder every surface renders from (see apps/backend/src/lib/mediaRequests.ts).
enum RequestStatus {
  newRequest('new', 'New'),
  planned('planned', 'Planned'),
  sourcing('sourcing', 'Sourcing'),
  added('added', 'Added'),
  declined('declined', 'Declined');

  const RequestStatus(this.wire, this.label);

  /// The value the API uses — `name` can't be it, since Dart reserves `new`.
  final String wire;
  final String label;

  static RequestStatus parse(String value) =>
      RequestStatus.values.firstWhere((s) => s.wire == value, orElse: () => RequestStatus.newRequest);

  /// The four forward steps of the timeline; `declined` is the off-ramp, not a step.
  static const progression = [
    RequestStatus.newRequest,
    RequestStatus.planned,
    RequestStatus.sourcing,
    RequestStatus.added,
  ];
}

/// What the catalog item a fulfilled request points at — the same shape the admin PATCH takes.
class CatalogRef {
  final String kind; // "video" | "folder"
  final String id;

  const CatalogRef({required this.kind, required this.id});

  factory CatalogRef.fromJson(Map<String, dynamic> json) =>
      CatalogRef(kind: json['kind'] as String, id: json['id'] as String);

  Map<String, dynamic> toJson() => {'kind': kind, 'id': id};

  @override
  bool operator ==(Object other) => other is CatalogRef && other.kind == kind && other.id == id;

  @override
  int get hashCode => Object.hash(kind, id);
}

/// The TMDB lookup behind a pasted reference link. Null on every field the lookup couldn't fill,
/// and the whole object is null when no `TMDB_API_KEY` is configured server-side — in which case
/// the link is still valid, just not enriched.
class RequestRefMeta {
  final String source; // "tmdb"
  final String sourceId;
  final String title;
  final int? year;
  final String? type; // "movie" | "series" | null
  final String? posterUrl;
  final String? overview;

  const RequestRefMeta({
    required this.source,
    required this.sourceId,
    required this.title,
    this.year,
    this.type,
    this.posterUrl,
    this.overview,
  });

  factory RequestRefMeta.fromJson(Map<String, dynamic> json) => RequestRefMeta(
    source: json['source'] as String,
    sourceId: json['sourceId'] as String,
    title: json['title'] as String,
    year: (json['year'] as num?)?.toInt(),
    type: json['type'] as String?,
    posterUrl: json['posterUrl'] as String?,
    overview: json['overview'] as String?,
  );
}

/// A request as any signed-in viewer sees it (`GET /api/requests`, `/mine`, `/match`).
class MediaRequest {
  final String id;
  final String title;
  final String? type; // "movie" | "series" | null — usually null
  final int? year; // usually null
  final String? refLink;
  final String? refImagePath; // "/api/request-image/<id>" — fetch with the Bearer header
  final RequestRefMeta? refMeta;
  final String? requestedByName;
  final bool isMine;
  final int wantCount;
  final bool iWantIt;
  final RequestStatus status;
  final String? adminNote;
  final CatalogRef? catalogRef;
  final DateTime? createdAt;
  final DateTime? statusChangedAt;

  const MediaRequest({
    required this.id,
    required this.title,
    this.type,
    this.year,
    this.refLink,
    this.refImagePath,
    this.refMeta,
    this.requestedByName,
    required this.isMine,
    required this.wantCount,
    required this.iWantIt,
    required this.status,
    this.adminNote,
    this.catalogRef,
    this.createdAt,
    this.statusChangedAt,
  });

  /// The one visual the board can show: the uploaded reference image if there is one, otherwise
  /// the poster the link lookup found. Null means "render the lettered placeholder".
  String? get posterUrl => refMeta?.posterUrl;

  bool get hasReference => (refLink != null && refLink!.isNotEmpty) || refImagePath != null;

  factory MediaRequest.fromJson(Map<String, dynamic> json) => MediaRequest(
    id: json['id'] as String,
    title: json['title'] as String,
    type: json['type'] as String?,
    year: (json['year'] as num?)?.toInt(),
    refLink: json['refLink'] as String?,
    refImagePath: json['refImagePath'] as String?,
    refMeta: json['refMeta'] == null
        ? null
        : RequestRefMeta.fromJson(json['refMeta'] as Map<String, dynamic>),
    requestedByName: json['requestedByName'] as String?,
    isMine: json['isMine'] as bool? ?? false,
    wantCount: (json['wantCount'] as num?)?.toInt() ?? 0,
    iWantIt: json['iWantIt'] as bool? ?? false,
    status: RequestStatus.parse(json['status'] as String),
    adminNote: json['adminNote'] as String?,
    catalogRef: json['catalogRef'] == null
        ? null
        : CatalogRef.fromJson(json['catalogRef'] as Map<String, dynamic>),
    createdAt: DateTime.tryParse(json['createdAt'] as String? ?? ''),
    statusChangedAt: DateTime.tryParse(json['statusChangedAt'] as String? ?? ''),
  );
}

/// One person attached to a request — the requester, or one of the (first 25) upvoters.
class RequestPerson {
  final String id;
  final String? name;
  final String? email;

  const RequestPerson({required this.id, this.name, this.email});

  factory RequestPerson.fromJson(Map<String, dynamic> json) => RequestPerson(
    id: json['id'] as String,
    name: json['name'] as String?,
    email: json['email'] as String?,
  );

  String get display => (name != null && name!.isNotEmpty) ? name! : (email ?? 'Someone');
}

/// `AdminRequest` — every [MediaRequest] field plus who asked, who else wants it and the title of
/// whatever catalog item it was fulfilled with. Admin-only (Windows desktop), see
/// platform_info.dart's isDesktopAdminCapable.
class AdminMediaRequest {
  final String id;
  final String title;
  final String? type;
  final int? year;
  final String? refLink;
  final String? refImagePath;
  final RequestRefMeta? refMeta;
  final RequestPerson? requestedBy;
  final int wantCount;
  final List<RequestPerson> voters;
  final RequestStatus status;
  final String? adminNote;
  final CatalogRef? catalogRef;
  final String? catalogTitle;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final DateTime? statusChangedAt;

  const AdminMediaRequest({
    required this.id,
    required this.title,
    this.type,
    this.year,
    this.refLink,
    this.refImagePath,
    this.refMeta,
    this.requestedBy,
    required this.wantCount,
    required this.voters,
    required this.status,
    this.adminNote,
    this.catalogRef,
    this.catalogTitle,
    this.createdAt,
    this.updatedAt,
    this.statusChangedAt,
  });

  factory AdminMediaRequest.fromJson(Map<String, dynamic> json) => AdminMediaRequest(
    id: json['id'] as String,
    title: json['title'] as String,
    type: json['type'] as String?,
    year: (json['year'] as num?)?.toInt(),
    refLink: json['refLink'] as String?,
    refImagePath: json['refImagePath'] as String?,
    refMeta: json['refMeta'] == null
        ? null
        : RequestRefMeta.fromJson(json['refMeta'] as Map<String, dynamic>),
    requestedBy: json['requestedBy'] == null
        ? null
        : RequestPerson.fromJson(json['requestedBy'] as Map<String, dynamic>),
    wantCount: (json['wantCount'] as num?)?.toInt() ?? 0,
    voters: (json['voters'] as List? ?? const [])
        .map((e) => RequestPerson.fromJson(e as Map<String, dynamic>))
        .toList(),
    status: RequestStatus.parse(json['status'] as String),
    adminNote: json['adminNote'] as String?,
    catalogRef: json['catalogRef'] == null
        ? null
        : CatalogRef.fromJson(json['catalogRef'] as Map<String, dynamic>),
    catalogTitle: json['catalogTitle'] as String?,
    createdAt: DateTime.tryParse(json['createdAt'] as String? ?? ''),
    updatedAt: DateTime.tryParse(json['updatedAt'] as String? ?? ''),
    statusChangedAt: DateTime.tryParse(json['statusChangedAt'] as String? ?? ''),
  );
}

/// `{ new, planned, sourcing, added, declined }` — drives the admin filter tabs and the top-bar
/// "N new" badge. Statuses the server didn't mention count as zero.
class RequestCounts {
  final Map<RequestStatus, int> byStatus;

  const RequestCounts(this.byStatus);

  factory RequestCounts.fromJson(Map<String, dynamic> json) => RequestCounts({
    for (final status in RequestStatus.values)
      status: (json[status.wire] as num?)?.toInt() ?? 0,
  });

  int operator [](RequestStatus status) => byStatus[status] ?? 0;

  int get total => byStatus.values.fold(0, (sum, n) => sum + n);
}

/// `POST /api/requests/resolve-link` on success. `meta` is null when the link is valid but the
/// backend has no TMDB key to enrich it with — accept it quietly rather than showing an empty card.
class ResolvedLink {
  final String source;
  final RequestRefMeta? meta;

  const ResolvedLink({required this.source, this.meta});

  factory ResolvedLink.fromJson(Map<String, dynamic> json) => ResolvedLink(
    source: json['source'] as String? ?? 'tmdb',
    meta: json['meta'] == null ? null : RequestRefMeta.fromJson(json['meta'] as Map<String, dynamic>),
  );
}

/// `POST /api/requests/reference-image` — the id is what the create call then references.
class UploadedReferenceImage {
  final String imageId;
  final int sizeBytes;
  final String path;

  const UploadedReferenceImage({required this.imageId, required this.sizeBytes, required this.path});

  factory UploadedReferenceImage.fromJson(Map<String, dynamic> json) => UploadedReferenceImage(
    imageId: json['imageId'] as String,
    sizeBytes: (json['sizeBytes'] as num?)?.toInt() ?? 0,
    path: json['path'] as String,
  );
}

/// An open request a search result already matches (`existingRequest` on a
/// `GET /api/requests/tmdb-search` row) — the form offers a vote on it instead of a duplicate.
class TmdbExistingRequest {
  final String id;
  final int wantCount;
  final RequestStatus status;
  /// The viewer already asked for or voted for it, so there's nothing left to offer.
  final bool iWantIt;

  const TmdbExistingRequest({
    required this.id,
    required this.wantCount,
    required this.status,
    required this.iWantIt,
  });

  factory TmdbExistingRequest.fromJson(Map<String, dynamic> json) => TmdbExistingRequest(
    id: json['id'] as String,
    wantCount: (json['wantCount'] as num?)?.toInt() ?? 0,
    status: RequestStatus.parse(json['status'] as String? ?? 'new'),
    iWantIt: json['iWantIt'] as bool? ?? false,
  );
}

/// One row of the request form's title search. `link` is the exact TMDb URL a pick submits as the
/// request's reference, so a picked request is the same thing a pasted TMDb link makes.
class TmdbSearchResult {
  final String tmdbType; // "movie" | "tv"
  final String tmdbId;
  final String title;
  final int? year;
  final String? overview;
  final String? posterUrl;
  final String link;
  /// Already published — the row opens it instead of offering a request.
  final CatalogRef? inLibrary;
  final TmdbExistingRequest? existingRequest;

  const TmdbSearchResult({
    required this.tmdbType,
    required this.tmdbId,
    required this.title,
    this.year,
    this.overview,
    this.posterUrl,
    required this.link,
    this.inLibrary,
    this.existingRequest,
  });

  bool get isSeries => tmdbType == 'tv';

  /// "Film" rather than "Movie" — the same word the web form uses.
  String get kindLabel => isSeries ? 'Series' : 'Film';

  /// Where "Already in Campfire" goes; null when it isn't.
  String? get libraryRoute {
    final ref = inLibrary;
    if (ref == null) return null;
    return ref.kind == 'folder' ? '/folder/${ref.id}' : '/watch/${ref.id}';
  }

  /// The same card the pasted-link preview shows, so a pick and a resolved link look alike.
  RequestRefMeta toRefMeta() => RequestRefMeta(
    source: 'tmdb',
    sourceId: tmdbId,
    title: title,
    year: year,
    type: isSeries ? 'series' : 'movie',
    posterUrl: posterUrl,
    overview: overview,
  );

  factory TmdbSearchResult.fromJson(Map<String, dynamic> json) => TmdbSearchResult(
    tmdbType: json['tmdbType'] as String? ?? 'movie',
    // Always a string from this backend; tolerated as a number so a stray int can't crash a row.
    tmdbId: '${json['tmdbId']}',
    title: json['title'] as String? ?? '',
    year: (json['year'] as num?)?.toInt(),
    overview: json['overview'] as String?,
    posterUrl: json['posterUrl'] as String?,
    link: json['link'] as String,
    inLibrary: json['inLibrary'] == null
        ? null
        : CatalogRef.fromJson(json['inLibrary'] as Map<String, dynamic>),
    existingRequest: json['existingRequest'] == null
        ? null
        : TmdbExistingRequest.fromJson(json['existingRequest'] as Map<String, dynamic>),
  );
}

/// `GET /api/requests/tmdb-search`. `available: false` means the backend has no TMDB key: the form
/// hides search and is just the paste-a-link / upload-an-image form, as before.
class TmdbSearchResponse {
  final bool available;
  final List<TmdbSearchResult> results;

  const TmdbSearchResponse({required this.available, this.results = const []});

  factory TmdbSearchResponse.fromJson(Map<String, dynamic> json) => TmdbSearchResponse(
    // Absent means an older backend that predates search answered somehow — treat as off.
    available: json['available'] as bool? ?? false,
    results: (json['results'] as List? ?? const [])
        .map((e) => TmdbSearchResult.fromJson(e as Map<String, dynamic>))
        .where((r) => r.title.isNotEmpty)
        .toList(),
  );
}
