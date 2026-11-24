import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPut } from "./api";
import type { TmdbRef } from "./types";

/** Embedded players, as the admin pages edit them (backend lib/embed.ts). */

export type EmbedOption = "startAt" | "autoplay" | "muted" | "hideControls";
export type EmbedProvider = { name: string; example: string; supports: EmbedOption[] };

export type EmbedInput = {
  url: string;
  enabled: boolean;
  startAt: number | null;
  autoplay: boolean;
  muted: boolean;
  hideControls: boolean;
};

/** `playerUrl` carries the options in the provider's own form; `available` is its answer. */
export type SavedEmbed = EmbedInput & { provider: string | null; playerUrl: string; available: boolean };

export type EmbeddedTitle = {
  key: string;
  fileId: string | null;
  title: string | null;
  embeds: { provider: string | null; enabled: boolean }[];
};

export function useEmbeddedTitles() {
  return useQuery({
    queryKey: ["admin-embeds", "titles"],
    queryFn: () => apiGet<{ providers: EmbedProvider[]; titles: EmbeddedTitle[] }>("/api/admin/embeds"),
  });
}

export function useVideoEmbeds(fileId: string) {
  return useQuery({
    queryKey: ["admin-embeds", "video", fileId],
    queryFn: () =>
      apiGet<{ tmdb: TmdbRef | null; max: number; providers: EmbedProvider[]; embeds: SavedEmbed[] }>(
        `/api/admin/embeds/video/${fileId}`,
      ),
    // The form seeds itself from this once, so it must never start from a stale copy.
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
}

export function useEmbedVideoSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ["admin-embeds", "search", q],
    queryFn: () =>
      apiGet<{ videos: { fileId: string; title: string; driveName: string }[] }>(
        `/api/admin/embeds/search?q=${encodeURIComponent(q)}`,
      ).then((r) => r.videos),
    enabled: q.length >= 2,
  });
}

function useInvalidateEmbeds() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["admin-embeds"] });
    queryClient.invalidateQueries({ queryKey: ["video"] });
  };
}

export function useSaveEmbeds(fileId: string) {
  const invalidate = useInvalidateEmbeds();
  return useMutation({
    mutationFn: (embeds: EmbedInput[]) =>
      apiPut<{ embeds: SavedEmbed[] }>(`/api/admin/embeds/video/${fileId}`, { embeds }),
    onSuccess: invalidate,
  });
}

export function useDeleteEmbeds() {
  const invalidate = useInvalidateEmbeds();
  return useMutation({
    mutationFn: (key: string) => apiDelete(`/api/admin/embeds/${encodeURIComponent(key)}`),
    onSuccess: invalidate,
  });
}

/** 90 → "1:30", 3725 → "1:02:05". */
export function formatClock(seconds: number | null): string {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** "1:30", "1:02:05" or plain seconds → seconds; empty → null; anything else → undefined. */
export function parseClock(text: string): number | null | undefined {
  const t = text.trim();
  if (!t) return null;
  if (!/^\d+(:[0-5]?\d){0,2}$/.test(t)) return undefined;
  return t.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}
