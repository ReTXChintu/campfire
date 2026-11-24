import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";
import type { RequestStatus, TmdbSearchResult } from "./types";

/** Explore — every film and series on TMDb, and where each streams in India. Shapes mirror
 * apps/backend/src/lib/explore.ts. Images are TMDb CDN URLs, loaded directly. */

export type ExploreKind = "all" | "movie" | "tv";

export type ExploreItem = {
  tmdbType: "movie" | "tv";
  tmdbId: string;
  title: string;
  year: number | null;
  rating: number | null;
  genres: string[];
  overview: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  /** The services this row was filtered by (badges on the poster); the full list is in details. */
  services: number[];
  inLibrary: TmdbSearchResult["inLibrary"];
};

export type ExploreRow = { id: string; title: string; items: ExploreItem[] };
export type ExploreService = { id: number; name: string; logoUrl: string | null };
export type ExploreOffer = { id: number; name: string; logoUrl: string | null; url: string };

export type ExploreDetail = Omit<ExploreItem, "services"> & {
  /** Absent from an older backend. */
  logoUrl?: string | null;
  tagline: string | null;
  runtime: number | null;
  seasons: number | null;
  episodes: number | null;
  cast: { name: string; character: string | null; profileUrl: string | null }[];
  link: string;
  watch: { link: string | null; stream: ExploreOffer[]; free: ExploreOffer[]; rentBuy: ExploreOffer[] };
  existingRequest: { id: string; wantCount: number; status: RequestStatus; iWantIt: boolean } | null;
};

export type ExplorePageResponse = {
  available: boolean;
  rows: ExploreRow[];
  services: ExploreService[];
  featured: ExploreDetail | null;
};

// TMDb's lists change a few times a day at most, and the server caches them for hours anyway.
const STALE_MS = 30 * 60_000;

export function useExplore(kind: ExploreKind, services: number[], enabled = true) {
  const key = [...services].sort((a, b) => a - b).join(",");
  return useQuery({
    queryKey: ["explore", kind, key],
    queryFn: () =>
      apiGet<ExplorePageResponse>(`/api/explore?kind=${kind}${key ? `&services=${encodeURIComponent(key)}` : ""}`),
    staleTime: STALE_MS,
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Under the "requests" key on purpose: asking for a title, or voting, refreshes its panel. */
export function useExploreTitle(type: "movie" | "tv" | null, tmdbId: string | null) {
  return useQuery({
    queryKey: ["requests", "explore-title", type, tmdbId],
    queryFn: () => apiGet<{ title: ExploreDetail }>(`/api/explore/title/${type}/${tmdbId}`).then((r) => r.title),
    enabled: Boolean(type && tmdbId),
    staleTime: 5 * 60_000,
  });
}

/** A title in the URL (`?title=movie-603`), so a panel can be linked to and Back closes it. */
export function parseTitleParam(value: string | null): { type: "movie" | "tv"; id: string } | null {
  const match = value?.match(/^(movie|tv)-(\d{1,10})$/);
  return match ? { type: match[1] as "movie" | "tv", id: match[2] } : null;
}

export const titleParam = (type: "movie" | "tv", id: string) => `${type}-${id}`;

export const libraryHref = (match: NonNullable<ExploreItem["inLibrary"]>) =>
  match.kind === "folder" ? `/folder/${match.id}` : `/watch/${match.id}`;

/** "2022 · Series · 3 seasons" / "2010 · Film · 2h 28m". */
export function exploreMetaLine(d: Pick<ExploreDetail, "year" | "tmdbType" | "runtime" | "seasons">): string {
  const parts: string[] = [];
  if (d.year) parts.push(String(d.year));
  parts.push(d.tmdbType === "tv" ? "Series" : "Film");
  if (d.tmdbType === "tv" && d.seasons) parts.push(`${d.seasons} season${d.seasons === 1 ? "" : "s"}`);
  if (d.tmdbType === "movie" && d.runtime) {
    const h = Math.floor(d.runtime / 60);
    const m = d.runtime % 60;
    parts.push(h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`);
  }
  return parts.join(" · ");
}

/** One poster on the fisheye wall (GET /api/explore/wall). */
export type WallItem = {
  tmdbType: "movie" | "tv";
  tmdbId: string;
  title: string;
  year: number | null;
  rating: number | null;
  genres: string[];
  posterPath: string;
  inCampfire: boolean;
};

export type ExploreWallResponse = {
  available: boolean;
  items: WallItem[];
  services: ExploreService[];
  imageBase: string | null;
};

export function useExploreWall(kind: ExploreKind, services: number[], enabled: boolean) {
  const key = [...services].sort((a, b) => a - b).join(",");
  return useQuery({
    queryKey: ["explore-wall", kind, key],
    queryFn: () =>
      apiGet<ExploreWallResponse>(`/api/explore/wall?kind=${kind}${key ? `&services=${encodeURIComponent(key)}` : ""}`),
    staleTime: STALE_MS,
    enabled,
  });
}
