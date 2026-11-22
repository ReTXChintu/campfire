import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost, apiPostText, apiPut } from "../lib/api";
import type { CatalogArtwork, CatalogFolder, CatalogVideo, FileTrack, TrackNaming, ViewerTrack } from "../lib/types";
import { useInvalidateCatalog } from "./useCatalog";

type AdminOverview = {
  pendingFolders: CatalogFolder[];
  pendingVideos: CatalogVideo[];
  unpublishedFolders: CatalogFolder[];
  unpublishedVideos: CatalogVideo[];
  rootFolders: CatalogFolder[];
  rootVideos: CatalogVideo[];
};

export function useAdminOverview() {
  return useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => apiGet<AdminOverview>("/api/admin/catalog/overview"),
  });
}

type AdminFolderDetail = {
  folder: CatalogFolder;
  breadcrumbs: CatalogFolder[];
  childFolders: CatalogFolder[];
  childVideos: CatalogVideo[];
  /** A series (or film folder) in the library root — the only folders artwork applies to. */
  isTopLevel?: boolean;
  /** Set when this folder sits inside a matched series, i.e. it's a season folder whose episodes
   * can be named from TMDb. `season` is what the backend worked out; `seasonFromName` says it was
   * guessed from the folder's name rather than set by an admin. */
  episodeSeries?: {
    folderId: string;
    title: string;
    season: number | null;
    seasonFromName: boolean;
  } | null;
};

export function useAdminFolder(folderId: string) {
  return useQuery({
    queryKey: ["admin-folder", folderId],
    queryFn: () => apiGet<AdminFolderDetail>(`/api/admin/catalog/folder/${folderId}`),
  });
}

export type SubtitleSetOption = {
  id: string;
  sourceLabel: string;
  createdAt: string;
  tracks: { index: number; language: string | null; title: string | null }[];
};

type AdminVideoDetail = {
  video: CatalogVideo;
  parentFolder: CatalogFolder | null;
  subtitleSetOptions: SubtitleSetOption[];
  /** A movie in the library root — episodes don't get artwork. */
  isTopLevel?: boolean;
};

export function useAdminVideo(fileId: string) {
  return useQuery({
    queryKey: ["admin-video", fileId],
    queryFn: () => apiGet<AdminVideoDetail>(`/api/admin/catalog/video/${fileId}`),
    // Poll while any rendition is still being generated, so the status chips (and eventually the
    // "Generate renditions" button re-enabling) update without a manual refresh — matches the
    // same reason the desktop app polls its own conversion jobs (background ffmpeg work, no websocket).
    refetchInterval: (query) => {
      const renditions = query.state.data?.video.renditions;
      const inFlight = renditions && Object.values(renditions).some((r) => r?.status === "queued" || r?.status === "processing");
      return inFlight ? 3000 : false;
    },
  });
}

export type ScanResult = {
  foldersScanned: number;
  videosScanned: number;
  foldersAdded: number;
  videosAdded: number;
  foldersDeleted: number;
  videosDeleted: number;
  deletedFolders: { id: string; driveName: string }[];
  deletedVideos: { id: string; driveName: string }[];
  erroredFolderIds: string[];
};

export function useRunScan() {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: () => apiPost<ScanResult>("/api/admin/scan"),
    onSuccess: invalidate,
  });
}

export function useSaveFolderTitle(folderId: string) {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: (title: string) => apiPatch(`/api/admin/catalog/folder/${folderId}`, { title }),
    onSuccess: invalidate,
  });
}

export function useToggleFolderPublish(folderId: string) {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: (action: "publish" | "unpublish") =>
      apiPost(`/api/admin/catalog/folder/${folderId}/${action}`),
    onSuccess: invalidate,
  });
}

export function useSaveVideo(fileId: string) {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: (update: {
      title: string;
      subtitleSetIds: string[];
      introStart: number | null;
      introEnd: number | null;
      outroStart: number | null;
    }) => apiPatch(`/api/admin/catalog/video/${fileId}`, update),
    onSuccess: invalidate,
  });
}

export function useToggleVideoPublish(fileId: string) {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: (action: "publish" | "unpublish") =>
      apiPost(`/api/admin/catalog/video/${fileId}/${action}`),
    onSuccess: invalidate,
  });
}

export function useGenerateRenditions(fileId: string) {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: () => apiPost<{ queued: number[] }>(`/api/admin/catalog/video/${fileId}/renditions`),
    onSuccess: invalidate,
  });
}

/** Trashes the Drive file and removes the video from Campfire entirely (subtitles, progress,
 * renditions, parties) — see the DELETE route in apps/backend/src/routes/admin/catalogVideo.ts. */
export function useDeleteVideo(fileId: string) {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: () => apiDelete<{ ok: true; parentFolderId: string }>(`/api/admin/catalog/video/${fileId}`),
    onSuccess: invalidate,
  });
}

export type ApplyPublishRuleResult = { ok: true; updated: number; skippedTitle: number; skippedIntro: number };

export function useApplyFolderPublishRule(folderId: string) {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: (rule: { namePattern: string; padding: number; introStart: number | null; introEnd: number | null; order: string[] }) =>
      apiPost<ApplyPublishRuleResult>(`/api/admin/catalog/folder/${folderId}/publish-rule/apply`, rule),
    onSuccess: invalidate,
  });
}

export function useBulkPublishFolder(folderId: string) {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: () =>
      apiPost<{ ok: true; publishedVideos: number; folderPublished: boolean }>(
        `/api/admin/catalog/folder/${folderId}/publish-rule/publish-all`,
      ),
    onSuccess: invalidate,
  });
}

export function useResetVideoOverride(fileId: string) {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: (field: "title" | "intro") =>
      apiPost(`/api/admin/catalog/video/${fileId}/reset-override`, { field }),
    onSuccess: invalidate,
  });
}

export function useUploadSubtitle(fileId: string) {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: ({ label, format, text }: { label: string; format: "srt" | "vtt"; text: string }) =>
      apiPostText<{ subtitleSetId: string }>(
        `/api/admin/catalog/video/${fileId}/subtitles?label=${encodeURIComponent(label)}&format=${format}`,
        text,
      ),
    onSuccess: invalidate,
  });
}

// --- Artwork (backend routes/admin/artwork.ts) --------------------------------------------------

export type ArtworkKind = "folder" | "video";

function useInvalidateArtwork(kind: ArtworkKind, id: string) {
  const queryClient = useQueryClient();
  const invalidateCatalog = useInvalidateCatalog();
  return () => {
    queryClient.invalidateQueries({ queryKey: [kind === "folder" ? "admin-folder" : "admin-video", id] });
    queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
    invalidateCatalog();
  };
}

/** Paste an IMDb/TMDb link, search TMDb now, or remove the artwork — one hook, three actions,
 * since the panel only ever runs one at a time. */
export function useArtworkAction(kind: ArtworkKind, id: string) {
  const invalidate = useInvalidateArtwork(kind, id);
  return useMutation({
    mutationFn: (action: { type: "link"; link: string } | { type: "auto" } | { type: "remove" }): Promise<unknown> => {
      const path = `/api/admin/catalog/artwork/${kind}/${id}`;
      if (action.type === "link") return apiPut<{ artwork: CatalogArtwork }>(path, { link: action.link });
      if (action.type === "auto") return apiPost<{ artwork: CatalogArtwork }>(`${path}/auto`);
      return apiDelete<{ ok: true }>(path);
    },
    onSuccess: invalidate,
  });
}

export type ArtworkAutoMatchResult = {
  matched: { kind: ArtworkKind; id: string; name: string; tmdbTitle: string; year: number | null }[];
  unmatched: { kind: ArtworkKind; id: string; name: string; query: string; year: number | null }[];
  /** Titles whose own name TMDb's replaced. Absent from an older backend. */
  renamed?: { kind: ArtworkKind; id: string; from: string; to: string }[];
  /** Already-matched titles topped up with metadata this backend knows how to fetch. */
  enriched?: number;
  episodes?: EpisodeMatchResult;
};

/** What naming a series' episodes did (backend lib/episodeArtwork.ts). */
export type EpisodeMatchResult = {
  matched: number;
  renamed: number;
  /** Folders that look like episodes but whose season couldn't be worked out from the name. */
  unresolved: { folderId: string; name: string }[];
};

/** Rename one title to the name TMDb uses. Unlike the rename that rides along with a match,
 * this overwrites a hand-typed name, because an admin pressed a button that says so. */
export function useUseTmdbTitle(kind: ArtworkKind, id: string) {
  const invalidate = useInvalidateArtwork(kind, id);
  return useMutation({
    mutationFn: () =>
      apiPost<{ from: string | null; to: string }>(`/api/admin/catalog/artwork/${kind}/${id}/use-tmdb-title`),
    onSuccess: invalidate,
  });
}

/** The same for every matched movie and series at once. */
export function useUseTmdbTitlesEverywhere() {
  const queryClient = useQueryClient();
  const invalidateCatalog = useInvalidateCatalog();
  return useMutation({
    mutationFn: () =>
      apiPost<{ renamed: { kind: ArtworkKind; id: string; from: string; to: string }[] }>(
        "/api/admin/catalog/artwork/use-tmdb-titles",
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
      queryClient.invalidateQueries({ queryKey: ["admin-folder"] });
      queryClient.invalidateQueries({ queryKey: ["admin-video"] });
      invalidateCatalog();
    },
  });
}

/** Name one series' episodes from TMDb now. `force` also replaces episode titles typed by hand,
 * which the ordinary pass deliberately leaves alone. */
export function useMatchEpisodes(folderId: string) {
  const invalidate = useInvalidateArtwork("folder", folderId);
  return useMutation({
    mutationFn: (options: { force?: boolean } = {}) =>
      apiPost<EpisodeMatchResult>(`/api/admin/catalog/artwork/folder/${folderId}/episodes`, {
        force: options.force === true,
      }),
    onSuccess: invalidate,
  });
}

/** Say which season a folder holds (null goes back to guessing from its name). Re-matches the
 * series' episodes, so it also invalidates the series folder, not just this one. */
export function useSetFolderSeason(folderId: string, seriesFolderId: string) {
  const invalidate = useInvalidateArtwork("folder", folderId);
  const invalidateSeries = useInvalidateArtwork("folder", seriesFolderId);
  return useMutation({
    mutationFn: (season: number | null) =>
      apiPut<EpisodeMatchResult>(`/api/admin/catalog/artwork/folder/${folderId}/season`, { season }),
    onSuccess: () => {
      invalidate();
      invalidateSeries();
    },
  });
}

/** What publishing a series' TMDb-named episodes would do, or did (backend
 * lib/episodeArtwork.ts's publishNamedEpisodes). */
export type PublishPreview = {
  seasons: {
    folderId: string;
    name: string;
    publishesFolder: boolean;
    /** "position" means nothing in the files confirms the names — flag it. */
    matchedBy: "filename" | "filename+gaps" | "position" | null;
    episodes: { id: string; episode: number | null; name: string }[];
  }[];
  skipped: { id: string; name: string; reason: "no-tmdb-name" | "held-back" | "folder-held-back" }[];
  seriesHidden: boolean;
  published: boolean;
};

/** Preview (`dryRun: true`) or publish a series' never-curated, TMDb-named episodes. */
export function usePublishNamedEpisodes(folderId: string) {
  const queryClient = useQueryClient();
  const invalidateCatalog = useInvalidateCatalog();
  return useMutation({
    mutationFn: ({ dryRun }: { dryRun: boolean }) =>
      apiPost<PublishPreview>(`/api/admin/catalog/artwork/folder/${folderId}/publish-episodes`, { dryRun }),
    onSuccess: (result) => {
      if (!result.published) return; // a preview changes nothing
      queryClient.invalidateQueries({ queryKey: ["admin-folder"] });
      queryClient.invalidateQueries({ queryKey: ["admin-video"] });
      queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
      invalidateCatalog();
    },
  });
}

/** Turn TMDb episode naming on or off for one series. */
export function useSetEpisodeNaming(folderId: string) {
  const invalidate = useInvalidateArtwork("folder", folderId);
  return useMutation({
    mutationFn: (enabled: boolean) =>
      apiPut<{ ok: true }>(`/api/admin/catalog/artwork/folder/${folderId}/episode-naming`, { enabled }),
    onSuccess: invalidate,
  });
}

export function useMatchMissingArtwork() {
  const queryClient = useQueryClient();
  const invalidateCatalog = useInvalidateCatalog();
  return useMutation({
    mutationFn: () => apiPost<ArtworkAutoMatchResult>("/api/admin/catalog/artwork/auto-match"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
      queryClient.invalidateQueries({ queryKey: ["admin-folder"] });
      queryClient.invalidateQueries({ queryKey: ["admin-video"] });
      invalidateCatalog();
    },
  });
}

// --- Audio and subtitle tracks (backend routes/admin/tracks.ts) ---------------------------------

export type TrackReportVideo = { id: string; title: string; season: string | null; status: CatalogVideo["status"] };

export type TrackLayout = { audio: FileTrack[]; subtitles: FileTrack[] };
export type EffectiveTracks = { audio: ViewerTrack[]; subtitles: ViewerTrack[] };

export type FolderTracks = {
  folderId: string;
  title: string;
  naming: TrackNaming;
  /** Merged from the folders above; empty for a series root. */
  inherited: TrackNaming;
  /** The most common layout below this folder — what the naming form edits. */
  usual: TrackLayout | null;
  effective: EffectiveTracks | null;
  report: {
    /** Every distinct layout, the usual one first. */
    groups: (TrackLayout & { usual: boolean; differences: string[]; videos: TrackReportVideo[] })[];
    unread: TrackReportVideo[];
    failed: (TrackReportVideo & { error: string })[];
  };
  /** Files still queued to be read, server-wide. */
  reading: number;
};

export type VideoTracks = {
  fileId: string;
  title: string;
  tracks: (TrackLayout & { readAt: string; readSize: number | null; error: string | null }) | null;
  naming: TrackNaming;
  inherited: TrackNaming;
  effective: EffectiveTracks | null;
  series: { id: string; title: string } | null;
  /** How this file differs from most of its series; empty when it doesn't (or has no series). */
  differences: string[];
  reading: number;
};

/** Names and defaults reach every episode below a folder, and the languages the details pages
 * list, so a save refreshes all of those. */
function useInvalidateTracks() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["admin-folder-tracks"] });
    queryClient.invalidateQueries({ queryKey: ["admin-video-tracks"] });
    queryClient.invalidateQueries({ queryKey: ["folder"] });
    queryClient.invalidateQueries({ queryKey: ["video"] });
  };
}

export function useFolderTracks(folderId: string) {
  return useQuery({
    queryKey: ["admin-folder-tracks", folderId],
    queryFn: () => apiGet<FolderTracks>(`/api/admin/catalog/tracks/folder/${folderId}`),
    // Files are read in the background (ffprobe, two at a time), so follow along while any are
    // queued. Unread files with nothing queued are only waiting on the next startup or a "Read
    // tracks again", so those get a slower check instead of none.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      if (data.reading > 0) return 3000;
      return data.report.unread.length > 0 ? 15000 : false;
    },
  });
}

export function useSaveFolderTracks(folderId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateTracks();
  return useMutation({
    mutationFn: (naming: TrackNaming) => apiPut<FolderTracks>(`/api/admin/catalog/tracks/folder/${folderId}`, naming),
    onSuccess: (data) => {
      queryClient.setQueryData(["admin-folder-tracks", folderId], data);
      invalidate();
    },
  });
}

/** Queues every file below the folder to be read again; the panel's polling picks up the rest. */
export function useReadFolderTracks(folderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<{ queued: number; reading: number }>(`/api/admin/catalog/tracks/folder/${folderId}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-folder-tracks", folderId] }),
  });
}

export function useVideoTracks(fileId: string) {
  return useQuery({
    queryKey: ["admin-video-tracks", fileId],
    queryFn: () => apiGet<VideoTracks>(`/api/admin/catalog/tracks/video/${fileId}`),
    // An unread file is usually just queued behind others; check back until it's been read.
    refetchInterval: (query) => (query.state.data && !query.state.data.tracks ? 5000 : false),
  });
}

export function useSaveVideoTracks(fileId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateTracks();
  return useMutation({
    mutationFn: (naming: TrackNaming) => apiPut<VideoTracks>(`/api/admin/catalog/tracks/video/${fileId}`, naming),
    onSuccess: (data) => {
      queryClient.setQueryData(["admin-video-tracks", fileId], data);
      invalidate();
    },
  });
}

/** Reads this one file now (a few seconds) and answers with the result. */
export function useReadVideoTracks(fileId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateTracks();
  return useMutation({
    mutationFn: () => apiPost<VideoTracks>(`/api/admin/catalog/tracks/video/${fileId}/read`),
    onSuccess: (data) => {
      queryClient.setQueryData(["admin-video-tracks", fileId], data);
      invalidate();
    },
  });
}
