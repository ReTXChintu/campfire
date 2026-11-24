import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";
import type { TmdbRef } from "./types";

export type Trailer = { name: string; youtubeId: string };

/** The title's official trailer, looked up by TMDb id; null when there isn't one. */
export function useTrailer(tmdb: Pick<TmdbRef, "type" | "id"> | null | undefined) {
  return useQuery({
    queryKey: ["trailer", tmdb?.type, tmdb?.id],
    queryFn: () => apiGet<{ trailer: Trailer | null }>(`/api/title/${tmdb!.type}/${tmdb!.id}/trailer`).then((r) => r.trailer),
    enabled: !!tmdb,
    staleTime: 60 * 60_000,
    retry: false,
  });
}

/** YouTube's player for it, starting by itself: only ever put up by a press. */
export const trailerSrc = (trailer: Trailer) =>
  `https://www.youtube-nocookie.com/embed/${trailer.youtubeId}?autoplay=1&rel=0`;
