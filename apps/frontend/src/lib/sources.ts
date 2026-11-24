import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "./api";
import type { PlayerFeature, PlayerFeatures } from "./types";

/** Video sources, as the admin page manages them (backend lib/videoSources.ts). Keys are only ever
 * sent, never read back. */

export type SourceKind = "bunny" | "cloudflare";

export type VideoSource = {
  id: string;
  kind: SourceKind | "drive";
  name: string;
  enabled: boolean;
  features: PlayerFeatures;
  config: { libraryId?: string; cdnHostname?: string; accountId?: string } | null;
  hasApiKey: boolean;
  hasTokenKey: boolean;
  sync: { at: string; error: string | null; videos: number; matched: number } | null;
};

export type SourceVideo = {
  videoId: string;
  name: string;
  ready: boolean;
  durationSeconds: number | null;
  height: number | null;
  key: string | null;
  linkedByHand: boolean;
  title: string | null;
};

export type SourceInput = {
  name?: string;
  enabled?: boolean;
  features?: PlayerFeatures;
  config?: VideoSource["config"];
  apiKey?: string;
  tokenKey?: string | null;
};

export const FEATURE_LABELS: Record<PlayerFeature, string> = {
  autoplay: "Autoplay",
  exit: "Exit player",
  pip: "Picture-in-picture",
  sourceMenu: "Source menu",
  captions: "Captions",
  quality: "Quality",
  volume: "Volume",
  fullscreen: "Fullscreen",
  settings: "Settings",
};

const KEY = ["admin-sources"];

export function useSources() {
  return useQuery({
    queryKey: [...KEY, "list"],
    queryFn: () => apiGet<{ features: PlayerFeature[]; sources: VideoSource[] }>("/api/admin/sources"),
  });
}

export function useSourceVideos(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...KEY, "videos", id],
    queryFn: () => apiGet<{ videos: SourceVideo[] }>(`/api/admin/sources/${id}/videos`).then((r) => r.videos),
    enabled,
  });
}

function useSourceMutation<T, R = unknown>(mutationFn: (input: T) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY });
      queryClient.invalidateQueries({ queryKey: ["video"] });
    },
  });
}

export const useCreateSource = () =>
  useSourceMutation((input: SourceInput & { kind: SourceKind }) => apiPost<{ id: string }>("/api/admin/sources", input));

export const useUpdateSource = () =>
  useSourceMutation(({ id, ...input }: SourceInput & { id: string }) => apiPatch(`/api/admin/sources/${id}`, input));

export const useDeleteSource = () => useSourceMutation((id: string) => apiDelete(`/api/admin/sources/${id}`));

export const useOrderSources = () => useSourceMutation((ids: string[]) => apiPut("/api/admin/sources/order", { ids }));

export const useSyncSource = () => useSourceMutation((id: string) => apiPost(`/api/admin/sources/${id}/sync`));

export const useLinkSourceVideo = () =>
  useSourceMutation(({ id, videoId, fileId }: { id: string; videoId: string; fileId: string | null }) =>
    apiPut(`/api/admin/sources/${id}/videos/${videoId}`, { fileId }),
  );
