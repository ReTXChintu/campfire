import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "../lib/api";
import type { LibraryResponse, FolderResponse, VideoResponse } from "../lib/types";

export function useLibrary() {
  return useQuery({ queryKey: ["library"], queryFn: () => apiGet<LibraryResponse>("/api/library") });
}

export function useFolder(folderId: string, season: string | null) {
  return useQuery({
    queryKey: ["folder", folderId, season],
    queryFn: () =>
      apiGet<FolderResponse>(`/api/folder/${folderId}${season ? `?season=${encodeURIComponent(season)}` : ""}`),
  });
}

export function useVideo(fileId: string) {
  return useQuery({ queryKey: ["video", fileId], queryFn: () => apiGet<VideoResponse>(`/api/video/${fileId}`) });
}

export function useSaveProgress() {
  return useMutation({
    mutationFn: (input: {
      fileId: string;
      parentFolderId: string;
      positionSeconds: number;
      durationSeconds: number;
    }) => apiPost("/api/progress", input),
  });
}

/** Invalidates every query that a publish/unpublish/curate action could affect — the public
 * library, the specific folder, and admin catalog views — rather than a blunt refetch-everything,
 * so a save on one video doesn't cause unrelated pages to refetch. */
export function useInvalidateCatalog() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["library"] });
    queryClient.invalidateQueries({ queryKey: ["folder"] });
    queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
    queryClient.invalidateQueries({ queryKey: ["admin-folder"] });
    queryClient.invalidateQueries({ queryKey: ["admin-video"] });
  };
}
