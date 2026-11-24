import { useMemo } from "react";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";
import type { ExploreItem, ExploreKind } from "./explore";

/** Home's feed: all of TMDb in sections (backend lib/feed.ts). The server makes it once a day. */

export type SectionLook = "poster" | "wide" | "rank";
export type FeedSection = { id: string; title: string; look: SectionLook; items: ExploreItem[] };
export type FeedHeroItem = ExploreItem & { logoUrl: string | null };

type FeedPage = { available: boolean; hero: FeedHeroItem[]; sections: FeedSection[]; next: number | null };
type SectionPage = { title: string; items: ExploreItem[]; next: number | null };

const STALE_MS = 30 * 60_000;
const ROW_SIZE = 24;
const MIN_ROW = 8;

/** The day the server makes the feed for. */
const feedDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

export const itemKey = (item: Pick<ExploreItem, "tmdbType" | "tmdbId">) => `${item.tmdbType}-${item.tmdbId}`;

export const sectionHref = (id: string, kind: ExploreKind) => `/section/${id}${kind === "all" ? "" : `?kind=${kind}`}`;

/** TMDb's own smaller cut of a backdrop: a card doesn't need the one that fills a screen. */
export const smallBackdrop = (url: string | null) => url?.replace("/w1280/", "/w780/") ?? null;

/** Every section without what the ones above it already show, unless that leaves too little. */
function withoutRepeats(sections: FeedSection[]): FeedSection[] {
  const shown = new Set<string>();
  return sections.map((section) => {
    const fresh = section.items.filter((item) => !shown.has(itemKey(item)));
    const items =
      section.look === "rank" ? section.items : (fresh.length >= MIN_ROW ? fresh : section.items).slice(0, ROW_SIZE);
    for (const item of items) shown.add(itemKey(item));
    return { ...section, items };
  });
}

export function useFeed(kind: ExploreKind) {
  const query = useInfiniteQuery({
    queryKey: ["feed", kind, feedDay()],
    queryFn: ({ pageParam }) => apiGet<FeedPage>(`/api/feed?kind=${kind}&page=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next,
    // Only what's in the library can change within the day.
    staleTime: STALE_MS,
  });
  const pages = query.data?.pages;
  const sections = useMemo(() => withoutRepeats(pages?.flatMap((p) => p.sections) ?? []), [pages]);
  return { ...query, available: pages?.[0]?.available, hero: pages?.[0]?.hero ?? [], sections };
}

export function useFeedSection(id: string, kind: ExploreKind) {
  const query = useInfiniteQuery({
    queryKey: ["feed-section", id, kind],
    queryFn: ({ pageParam }) =>
      apiGet<SectionPage>(`/api/feed/section/${encodeURIComponent(id)}?kind=${kind}&page=${pageParam}`),
    initialPageParam: 1,
    getNextPageParam: (last) => last.next,
    staleTime: STALE_MS,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const pages = query.data?.pages;
  // TMDb's lists move while they're paged through, so a title can come twice.
  const items = useMemo(
    () => [...new Map(pages?.flatMap((p) => p.items).map((i) => [itemKey(i), i]) ?? []).values()],
    [pages],
  );
  return { ...query, title: pages?.[0]?.title, items };
}

export function useSimilarTitles(type: "movie" | "tv", id: string) {
  return useQuery({
    queryKey: ["similar-titles", type, id],
    queryFn: () => apiGet<{ items: ExploreItem[] }>(`/api/explore/title/${type}/${id}/similar`).then((r) => r.items),
    staleTime: STALE_MS,
    retry: false,
  });
}
