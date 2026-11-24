import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut } from "./api";
import type { ExploreItem } from "./explore";
import type { TmdbRef } from "./types";

/** What the viewer has watched, liked and disliked, and what that suggests (backend
 * lib/opinions.ts and lib/forYou.ts). All of it is read at once, so any card can look itself up. */

export type Rating = "like" | "dislike";
export type Opinion = { type: "movie" | "tv"; id: string; watched: boolean; rating: Rating | null };
/** A film or a whole series. An episode is neither. */
export type TitleRef = Pick<TmdbRef, "type" | "id">;

export type ForYouResponse = {
  ready: boolean;
  library: { kind: "folder" | "video"; id: string; reason: string | null }[];
  explore: (ExploreItem & { reason: string | null })[];
};

const KEY = ["opinions"];
const FOR_YOU_KEY = ["for-you"];
const keyOf = (ref: TitleRef) => `${ref.type}:${ref.id}`;

function useOpinions() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => apiGet<{ opinions: Opinion[] }>("/api/opinions").then((r) => r.opinions),
    staleTime: 60_000,
  });
}

/** The viewer's opinion of a title; undefined when there's none, or none is known yet. */
export function useOpinion(ref: TitleRef | null | undefined): Opinion | undefined {
  const { data } = useOpinions();
  const key = ref ? keyOf(ref) : null;
  return useMemo(() => (key ? data?.find((o) => keyOf(o) === key) : undefined), [data, key]);
}

/** Shown as set right away, and put back if the server doesn't take it. */
export function useSetOpinion(ref: TitleRef) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: KEY,
    mutationFn: (change: { watched?: boolean; rating?: Rating | null }) => apiPut(`/api/opinions/${ref.type}/${ref.id}`, change),
    // One at a time, so the last click is what's kept.
    scope: { id: `opinion-${keyOf(ref)}` },
    onMutate: async (change) => {
      await queryClient.cancelQueries({ queryKey: KEY });
      const before = queryClient.getQueryData<Opinion[]>(KEY);
      const mine = before?.find((o) => keyOf(o) === keyOf(ref)) ?? { ...ref, type: ref.type, id: ref.id, watched: false, rating: null };
      queryClient.setQueryData<Opinion[]>(KEY, [...(before ?? []).filter((o) => keyOf(o) !== keyOf(ref)), { ...mine, ...change }]);
      return { before };
    },
    onError: (_error, _change, context) => queryClient.setQueryData(KEY, context?.before),
    onSettled: () => {
      // Only once the last of several quick clicks is through.
      if (queryClient.isMutating({ mutationKey: KEY }) > 1) return;
      queryClient.invalidateQueries({ queryKey: KEY });
      queryClient.invalidateQueries({ queryKey: FOR_YOU_KEY });
      queryClient.invalidateQueries({ queryKey: ["library"] });
    },
  });
}

export function useForYou() {
  return useQuery({
    queryKey: FOR_YOU_KEY,
    queryFn: () => apiGet<ForYouResponse>("/api/opinions/for-you"),
    staleTime: 60_000,
  });
}
