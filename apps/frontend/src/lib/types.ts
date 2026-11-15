import type { StreamTrack } from "./languageNames";
import type { CatalogListItem } from "./catalogListItem";

export type WatchProgress = {
  userId: string;
  fileId: string;
  parentFolderId: string;
  positionSeconds: number;
  durationSeconds: number;
  completed: boolean;
  updatedAt: string;
};

export type QualityOption = { label: string; height: number };

export type ProbeResult = {
  videoTrack: { index: number; codecName: string; width: number | null; height: number | null } | null;
  audioTracks: StreamTrack[];
  subtitleTracks: StreamTrack[];
  durationSeconds: number | null;
  sourceHeight: number | null;
  sourceWidth: number | null;
  availableQualities: QualityOption[];
};

export type ConvertedSubtitle = {
  index: number;
  language: string | null;
  title: string | null;
  vtt: string;
};

/** A movie's or series' TMDb match (backend lib/artwork.ts). Admin-only detail; viewers just get
 * the image through the usual thumbnail routes plus `year`/`overview` on the detail responses. */
export type CatalogArtwork = {
  source: "link" | "auto";
  tmdbType: "movie" | "tv";
  tmdbId: string;
  title: string;
  year: number | null;
  overview: string | null;
  backdropPath: string | null;
  posterPath: string | null;
  matchedAt: string;
};

type ArtworkFields = {
  artwork?: CatalogArtwork | null;
  /** Removed by an admin; not matched automatically again until they ask. */
  artworkAutoOff?: boolean;
};

export type CatalogFolderStatus = "pending" | "curated" | "published";

export type CatalogFolderPublishRule = {
  namePattern: string;
  padding: number;
  introStart: number | null;
  introEnd: number | null;
};

export type CatalogFolder = {
  _id: string;
  parentFolderId: string;
  driveName: string;
  thumbnailFileId: string | null;
  status: CatalogFolderStatus;
  title: string | null;
  publishRule: CatalogFolderPublishRule | null;
  createdAt: string;
  curatedAt: string | null;
  curatedBy: string | null;
  updatedAt: string;
} & ArtworkFields;

export type CatalogVideoStatus = "pending" | "curated" | "published";

export type RenditionStatus = "queued" | "processing" | "done" | "failed";
export type RenditionEntry = { status: RenditionStatus; error: string | null; generatedAt: string | null };
// Keyed by height as a string ("480" | "720" | "1080").
export type CatalogVideoRenditions = Partial<Record<string, RenditionEntry>>;

export type CatalogVideo = {
  _id: string;
  parentFolderId: string;
  driveName: string;
  mimeType: string;
  sizeBytes: number | null;
  durationSeconds: number | null;
  status: CatalogVideoStatus;
  title: string | null;
  subtitleSetIds: string[];
  introStart: number | null;
  introEnd: number | null;
  outroStart: number | null;
  episodeOrder: number | null;
  titleOverridden: boolean;
  introOverridden: boolean;
  renditions: CatalogVideoRenditions;
  createdAt: string;
  curatedAt: string | null;
  curatedBy: string | null;
  updatedAt: string;
} & ArtworkFields;

/** One slide of the Home spotlight carousel. `kind` describes what the badge is saying, not what
 * the item is: "new"/"featured" are library picks, "request" is a title somebody asked for that
 * has since been published (and only those slides carry the request fields). */
export type SpotlightSlide = {
  id: string;
  kind: "new" | "featured" | "request";
  title: string;
  badge: string;
  playHref: string;
  infoHref: string | null;
  // A ready-to-fetch backend path (e.g. "/api/thumbnail/<id>"), or null when a folder simply has
  // no thumbnail yet — the carousel then keeps its coloured gradient
  // backdrop by design; included so the type matches what the backend actually sends.
  thumbnailPath: string | null;
  requestId?: string;
  requestedByName?: string | null;
  youAsked?: boolean;
};

export type LibraryResponse = {
  empty: boolean;
  spotlight: SpotlightSlide[];
  // Deprecated: always equal to spotlight[0], kept by the backend for older installed app builds.
  // New client code reads `spotlight` and ignores this.
  hero: { title: string; badge: string; playHref: string; infoHref: string | null; thumbnailPath: string | null } | null;
  continueWatching: { item: CatalogListItem; progress: WatchProgress }[];
  folders: CatalogListItem[];
  videos: CatalogListItem[];
  // This user's progress on the library's own videos, completed ones included — so a film card
  // can show it was watched. Absent from a backend older than the field.
  progress?: WatchProgress[];
};

export type FolderFlatResponse = {
  mode: "flat";
  folderId: string;
  title: string | null;
  backHref: string;
  thumbnailFileId: string | null;
  /** From the TMDb match; absent from older backends. */
  year?: number | null;
  overview?: string | null;
  items: CatalogListItem[];
  progress: WatchProgress[];
};

export type FolderSeriesResponse = {
  mode: "series";
  folderId: string;
  title: string | null;
  backHref: string;
  thumbnailFileId: string | null;
  year?: number | null;
  overview?: string | null;
  seasons: { id: string; name: string }[];
  selectedSeasonId: string;
  seasonItems: CatalogListItem[];
  specialItems: CatalogListItem[];
  progress: WatchProgress[];
};

export type FolderResponse = FolderFlatResponse | FolderSeriesResponse;

export type VideoResponse = {
  fileId: string;
  title: string | null;
  /** A movie's TMDb year and synopsis, when it's matched. */
  year?: number | null;
  overview?: string | null;
  backHref: string;
  parentFolderId: string;
  nextFileId: string | null;
  previousFileId: string | null;
  episodes: { id: string; name: string }[];
  progressByFileId: Record<string, { positionSeconds: number; completed: boolean }>;
  initialPositionSeconds: number;
  initialCompleted: boolean;
  seekMode: "native" | "restart" | "raw";
  durationSeconds: number | null;
  subtitles: ConvertedSubtitle[];
  introStart: number | null;
  introEnd: number | null;
  outroStart: number | null;
  // Remembered track choices (see apps/backend/src/lib/progress.ts) — null means "no preference
  // recorded yet", not "off". initialSubtitleIndex is only meaningful when the source is
  // "external" (an index into `subtitles` above) or "restart" (a raw ffprobe stream index, used
  // by the live-extracted-on-seek subtitle path non-native content uses) *and* the preference came
  // from this exact video's own history — the backend nulls it out when falling back to a sibling
  // episode's preference (series-wide propagation), since a raw index only means something within
  // a single video's own track list. initialSubtitleLanguage/initialSubtitleTitle are the
  // name-based identity to match against `subtitles`/the probe's subtitle tracks instead in that
  // case (or preferably always, since name-matching is more robust than index even for the
  // same-video case). Audio is matched by language+title rather than a raw index, since the
  // identifier space isn't portable across seekModes/players.
  initialSubtitleSource: "off" | "external" | "restart" | null;
  initialSubtitleIndex: number | null;
  initialSubtitleLanguage: string | null;
  initialSubtitleTitle: string | null;
  initialAudioLanguage: string | null;
  initialAudioTitle: string | null;
};

export type WatchParty = {
  id: string;
  roomName: string;
  fileId: string;
  title: string | null;
  hostUserId: string;
  hostParticipantIdentity: string;
  playing: boolean;
  positionSeconds: number;
  effectivePositionSeconds: number;
  playbackRate: number;
  serverTimeMs?: number;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
};

export type WatchPartyClientKind = "web" | "windows" | "android" | "ios";
export type WatchPartyDeviceRole = "main" | "companion";

export type WatchPartyExistingSessionInfo = {
  deviceLabel: string;
  clientKind: WatchPartyClientKind;
};

export type WatchPartyJoinTokenResponse = {
  serverUrl: string;
  participantToken: string;
  participantIdentity: string;
  participantName: string;
  isHost: boolean;
  deviceRole: WatchPartyDeviceRole;
  canControlPlayback: boolean;
  party: WatchParty;
};

// join-token doesn't always succeed outright — if this user already has another active device in
// this party, it instead asks the caller to confirm (or, for a mobile+mobile pairing, to pick
// which device is main) before actually joining. See apps/backend/src/routes/watchParties.ts.
export type WatchPartyJoinTokenResult =
  | ({ requiresConfirmation?: false; requiresRoleChoice?: false } & WatchPartyJoinTokenResponse)
  | { requiresConfirmation: true; requiresRoleChoice?: false; existingSession: WatchPartyExistingSessionInfo }
  | { requiresConfirmation?: false; requiresRoleChoice: true; existingSession: WatchPartyExistingSessionInfo };

export type WatchPartyParticipant = {
  userId: string;
  deviceId: string;
  deviceLabel: string;
  clientKind: WatchPartyClientKind;
  role: "host" | "guest";
  deviceRole: WatchPartyDeviceRole;
  canControlPlayback: boolean;
};

export type WatchPartySyncState = {
  type: "sync-state";
  playing: boolean;
  positionSeconds: number;
  playbackRate: number;
  updatedAt: string;
  // Added with the phone/desktop app's sync rewrite; all optional so either side can be older.
  // "action" = someone did something (snap to it); "heartbeat" = the leader's periodic position
  // (only correct real drift); "snapshot" = the server's stored state, read on join.
  kind?: "action" | "heartbeat" | "snapshot";
  serverTimeMs?: number;
  fileId?: string | null;
  // Local-only: when this state arrived here. Elapsed time is measured from arrival, never from
  // the sender's clock, which may be seconds off from ours.
  receivedAtMs?: number;
  // Local-only: a state this device emitted itself, kept for display but never re-applied.
  self?: boolean;
};

// --- Media requests ---------------------------------------------------------------------------
// A request is two fields: a title plus one reference (an IMDb/TMDb link OR an uploaded image).
// `type` and `year` are filled in by the link lookup or by an admin, so they are usually null —
// render the type chip and the year only when present (see docs/API-CONTRACT).

export type RequestStatus = "new" | "planned" | "sourcing" | "added" | "declined";

export type RequestRefMeta = {
  source: "tmdb";
  sourceId: string;
  title: string;
  year: number | null;
  type: "movie" | "series" | null;
  posterUrl: string | null;
  overview: string | null;
};

export type RequestCatalogRef = { kind: "video" | "folder"; id: string };

export type PublicRequest = {
  id: string;
  title: string;
  type: "movie" | "series" | null;
  year: number | null;
  refLink: string | null;
  // "/api/request-image/<id>" — Bearer-gated, so it goes through useAuthedImage, not a bare src.
  refImagePath: string | null;
  refMeta: RequestRefMeta | null;
  requestedByName: string | null;
  isMine: boolean;
  wantCount: number;
  iWantIt: boolean;
  status: RequestStatus;
  adminNote: string | null;
  catalogRef: RequestCatalogRef | null;
  createdAt: string;
  statusChangedAt: string;
};

export type RequestCounts = Record<RequestStatus, number>;

export type AdminRequest = Omit<PublicRequest, "isMine" | "iWantIt"> & {
  requestedBy: { id: string; name: string | null; email: string | null };
  voters: { id: string; name: string | null; email: string | null }[];
  catalogTitle: string | null;
  updatedAt: string;
};

export type ResolveLinkResult = { ok: true; source: string; meta: RequestRefMeta | null };
