import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";
import type { TmdbRef } from "./types";

/** Playing any title on TMDb, in the library or not (backend lib/titlePlay.ts). */

/** Where a Play button goes. A series carries on where the viewer stopped, else starts. */
export function playHref(ref: Pick<TmdbRef, "type" | "id" | "season" | "episode">): string {
  const episode = ref.season != null && ref.episode != null ? `?season=${ref.season}&episode=${ref.episode}` : "";
  return `/play/${ref.type}/${ref.id}${episode}`;
}

/** Whether this is watched as a title, not as one of the library's files. */
export const isTitleId = (id: string) => id.startsWith("tmdb:");

/** The film or series behind a title's id. */
export function titleOfId(id: string): { type: "movie" | "tv"; id: string } | null {
  const match = id.match(/^tmdb:(movie|tv):(\d+)/);
  return match ? { type: match[1] as "movie" | "tv", id: match[2] } : null;
}

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
