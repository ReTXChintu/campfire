import { useMutation, useQuery } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost, apiPostText } from "../lib/api";
import type { CatalogFolder, CatalogVideo } from "../lib/types";
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
};

export function useAdminVideo(fileId: string) {
  return useQuery({
    queryKey: ["admin-video", fileId],
    queryFn: () => apiGet<AdminVideoDetail>(`/api/admin/catalog/video/${fileId}`),
    // Poll while any rendition is still being generated, so the status chips (and eventually the
    // "Generate renditions" button re-enabling) update without a manual refresh — matches the
    // Converter tab's polling pattern for the same reason (background ffmpeg work, no websocket).
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
