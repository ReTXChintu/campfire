import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";
import type { TmdbRef } from "./types";

/** Playing any title on TMDb, in the library or not (backend lib/titlePlay.ts). */

/** Where a Play button goes. A series carries on where the viewer stopped, else starts. `source` plays
 * it from that one alone; without it they're all tried in order. */
export function playHref(ref: Pick<TmdbRef, "type" | "id" | "season" | "episode">, source?: string): string {
  return `/play/${ref.type}/${ref.id}${queryOf(ref, source)}`;
}

function queryOf(ref: Pick<TmdbRef, "season" | "episode">, source?: string): string {
  const query = new URLSearchParams();
  if (ref.season != null && ref.episode != null) {
    query.set("season", String(ref.season));
    query.set("episode", String(ref.episode));
  }
  if (source) query.set("source", source);
  return query.size ? `?${query}` : "";
}

export type TitleSource = { id: string; name: string; result: "found" | "none" | "unreachable"; needsApp: boolean };

/** Every source and whether it has a title, asked each time this is opened. */
export function useTitleSources(ref: TmdbRef) {
  return useQuery({
    queryKey: ["title-sources", ref.type, ref.id, ref.season, ref.episode],
    queryFn: () =>
      apiGet<{ sources: TitleSource[] }>(`/api/title/${ref.type}/${ref.id}/sources${queryOf(ref)}`).then((r) => r.sources),
    gcTime: 0,
    retry: false,
  });
}

/** Whether this is watched as a title, not as one of the library's files. */
export const isTitleId = (id: string) => id.startsWith("tmdb:");

export type SeriesEpisode = {
  number: number;
  name: string;
  overview: string | null;
  airDate: string | null;
  runtimeMinutes: number | null;
  rating: { average: number; count: number } | null;
  aired: boolean;
  stillUrl: string | null;
  progress: { positionSeconds: number; durationSeconds: number; completed: boolean } | null;
};

export type SeriesEpisodes = {
  seasons: { number: number; name: string; count: number }[];
  season: number;
  resume: { season: number; episode: number; started: boolean };
  episodes: SeriesEpisode[];
};

/** A season's episodes; the one the viewer is in when none is asked for. */
export function useSeriesEpisodes(seriesId: string | null, season: number | null) {
  return useQuery({
    queryKey: ["series-episodes", seriesId, season],
    queryFn: () => apiGet<SeriesEpisodes>(`/api/title/tv/${seriesId}/episodes${season === null ? "" : `?season=${season}`}`),
    enabled: seriesId !== null,
    placeholderData: keepPreviousData,
    retry: false,
  });
}
