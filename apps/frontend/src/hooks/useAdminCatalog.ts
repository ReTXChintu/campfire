import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost, apiPostText, apiPut } from "../lib/api";
import type { CatalogArtwork, CatalogFolder, CatalogVideo } from "../lib/types";
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
};

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
