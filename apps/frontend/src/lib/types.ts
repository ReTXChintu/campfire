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
};

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
};

export type LibraryResponse = {
  empty: boolean;
  // thumbnailPath is a ready-to-fetch backend path (e.g. "/api/thumbnail/<id>"), or null when a
  // folder simply has no thumbnail yet — not currently rendered on web (Hero.tsx is gradient-only
  // by design there too), included here just so the type matches what the backend actually sends.
  hero: { title: string; badge: string; playHref: string; infoHref: string | null; thumbnailPath: string | null } | null;
  continueWatching: { item: CatalogListItem; progress: WatchProgress }[];
  folders: CatalogListItem[];
  videos: CatalogListItem[];
};

export type FolderFlatResponse = {
  mode: "flat";
  folderId: string;
  title: string | null;
  backHref: string;
  thumbnailFileId: string | null;
  items: CatalogListItem[];
  progress: WatchProgress[];
};

export type FolderSeriesResponse = {
  mode: "series";
  folderId: string;
  title: string | null;
  backHref: string;
  thumbnailFileId: string | null;
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
};
