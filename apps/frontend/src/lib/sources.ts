import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "./api";
import type { PlayerFeature, PlayerFeatures, PlayerFrame } from "./types";

/** Video sources, as the admin page manages them (backend lib/videoSources.ts). Keys are only ever
 * sent, never read back. */

/** "frame" is any other site's player, added by its embed code. */
export type SourceKind = "bunny" | "cloudflare" | "frame";

export type FrameConfig = PlayerFrame & { template: string };
/** A player can have a different address for each kind of title. */
export const FRAME_KINDS = ["movie", "tv", "anime"] as const;
export type FrameKind = (typeof FRAME_KINDS)[number];
export type FrameConfigs = Record<FrameKind, FrameConfig | null>;
export type FramePreview = { config: FrameConfig; siteName: string; ignored: string[] };

export type VideoSource = {
  id: string;
  kind: SourceKind | "drive";
  name: string;
  enabled: boolean;
  features: PlayerFeatures;
  config: ({ libraryId?: string; cdnHostname?: string; accountId?: string } & Partial<FrameConfigs>) | null;
  hasApiKey: boolean;
  hasTokenKey: boolean;
  sync: { at: string; error: string | null; videos: number; matched: number } | null;
};

export type SourceInput = {
  name?: string;
  enabled?: boolean;
  features?: PlayerFeatures;
  config?: VideoSource["config"];
  codes?: Record<FrameKind, string>;
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

/** What the server reads an embed code as. */
export function useFramePreview(code: string) {
  return useQuery({
    queryKey: ["admin-source-code", code],
    queryFn: () => apiPost<FramePreview>("/api/admin/sources/read-code", { code }),
    enabled: code !== "",
    retry: false,
    staleTime: Infinity,
  });
}

/** A saved player's embed code again, for changing it. */
export function frameCode(config: FrameConfig | null | undefined): string {
  if (!config) return "";
  const { template, allow, allowFullscreen, sandbox, referrerPolicy, radius, ratio } = config;
  const quoted = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return [
    "<iframe",
    `  src="${quoted(template)}"`,
    ...(ratio ? [`  width="${Math.round(ratio * 1080)}"`, '  height="1080"'] : ['  width="100%"', '  height="100%"']),
    ...(radius !== null ? [`  style="border: 0; border-radius: ${radius}px;"`] : []),
    `  allow="${quoted(allow)}"`,
    ...(allowFullscreen ? ["  allowfullscreen"] : []),
    `  sandbox="${quoted(sandbox)}"`,
    `  referrerpolicy="${quoted(referrerPolicy)}"`,
    "></iframe>",
  ].join("\n");
}
