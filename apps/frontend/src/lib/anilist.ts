import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPut } from "./api";

/** Anime titles as AniList knows them (backend lib/anilistLink.ts): which AniList entry and episode
 * each TMDb episode is, for players that take an AniList id. */

export type AnimeType = "movie" | "tv";

/** TMDb episodes `from`–`to` of `season` are AniList entry `anilistId`, episode = TMDb's + `shift`. */
export type AnimeSegment = { season: number; from: number; to: number; anilistId: number; shift: number };

export type AnimeLink = {
  type: AnimeType;
  tmdbId: string;
  title: string;
  origin: "map" | "match" | "none";
  segments: AnimeSegment[];
  movie: number | null;
  problems: string[];
  builtAt: string;
  admin: { off: boolean; segments: AnimeSegment[] | null; movie: number | null } | null;
  entries: { id: number; title: string | null; format: string | null; episodes: number | null; startDate: string | null; status: string | null }[];
};

export type AnimeListItem = {
  type: AnimeType;
  tmdbId: string;
  title: string;
  origin: AnimeLink["origin"];
  problems: number;
  admin: "off" | "set" | null;
  builtAt: string;
};

const KEY = ["admin-anilist"];

export function useAnimeTitles() {
  return useQuery({
    queryKey: [...KEY, "list"],
    queryFn: () => apiGet<{ titles: AnimeListItem[] }>("/api/admin/anilist").then((r) => r.titles),
  });
}

export function useAnimeLink(title: { type: AnimeType; tmdbId: string } | null) {
  return useQuery({
    queryKey: [...KEY, title?.type, title?.tmdbId],
    queryFn: () => apiGet<AnimeLink>(`/api/admin/anilist/${title!.type}/${title!.tmdbId}`),
    enabled: !!title,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

function useLinkMutation<T>(fn: (input: T) => Promise<AnimeLink>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (link) => {
      queryClient.setQueryData([...KEY, link.type, link.tmdbId], link);
      queryClient.invalidateQueries({ queryKey: [...KEY, "list"] });
    },
  });
}

/** Made again from the mapping file and AniList, now. */
export const useRecheckAnime = () =>
  useLinkMutation(({ type, tmdbId }: { type: AnimeType; tmdbId: string }) =>
    apiGet<AnimeLink>(`/api/admin/anilist/${type}/${tmdbId}?fresh=1`),
  );

export const useSetAnime = () =>
  useLinkMutation(
    ({ type, tmdbId, body }: { type: AnimeType; tmdbId: string; body: { segments: AnimeSegment[] } | { movie: number } | { off: true } }) =>
      apiPut<AnimeLink>(`/api/admin/anilist/${type}/${tmdbId}`, body),
  );

export const useResetAnime = () =>
  useLinkMutation(({ type, tmdbId }: { type: AnimeType; tmdbId: string }) =>
    apiDelete<AnimeLink>(`/api/admin/anilist/${type}/${tmdbId}`),
  );

/** "https://www.themoviedb.org/tv/85937-demon-slayer", "tv 85937", "movie/372058". */
export function parseTmdbTitle(text: string): { type: AnimeType; tmdbId: string } | null {
  const m = text.trim().match(/\b(tv|movie)\s*[/:\s-]\s*(\d{1,10})\b/i);
  return m ? { type: m[1].toLowerCase() as AnimeType, tmdbId: String(Number(m[2])) } : null;
}
