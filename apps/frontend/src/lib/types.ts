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

export type ProbeResult = {
  videoTrack: { index: number; codecName: string } | null;
  audioTracks: StreamTrack[];
  subtitleTracks: StreamTrack[];
  durationSeconds: number | null;
};

export type ConvertedSubtitle = {
  index: number;
  language: string | null;
  title: string | null;
  vtt: string;
};

export type CatalogFolderStatus = "pending" | "curated" | "published";
export type CatalogFolder = {
  _id: string;
  parentFolderId: string;
  driveName: string;
  thumbnailFileId: string | null;
  status: CatalogFolderStatus;
  title: string | null;
  createdAt: string;
  curatedAt: string | null;
  curatedBy: string | null;
  updatedAt: string;
};

export type CatalogVideoStatus = "pending" | "curated" | "published";
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
  createdAt: string;
  curatedAt: string | null;
  curatedBy: string | null;
  updatedAt: string;
};

export type LibraryResponse = {
  empty: boolean;
  hero: { title: string; badge: string; playHref: string; infoHref: string | null } | null;
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
  seekMode: "native" | "restart";
  durationSeconds: number | null;
  subtitles: ConvertedSubtitle[];
  introStart: number | null;
  introEnd: number | null;
  outroStart: number | null;
};
