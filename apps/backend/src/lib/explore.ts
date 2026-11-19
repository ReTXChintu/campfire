import { env } from "../config/env";
import { tmdbFetch } from "./referenceLink";
import { libraryMatches, requestMatches, type TmdbSearchResult } from "./tmdbSearch";

/**
 * Explore: all of TMDb, not just the library — rows of films and series to browse for anyone who
 * doesn't know what to watch, and for each one where it streams in India.
 *
 * Every TMDb answer is cached here, keyed by its exact path and query, so the number of calls
 * depends on how many *different* rows exist, never on how many people open the page: a full page
 * is about 15 calls, then nothing for LIST_TTL_MS. (TMDb has no daily quota, only a burst limit of
 * roughly 40 requests a second; MAX_IN_FLIGHT keeps a cold page well under it.) What is per viewer
 * — "in Campfire", "already requested" — comes from Mongo on every call and is never cached.
 *
 * Posters, backdrops and service logos load straight from TMDb's image CDN, like the request
 * form's search results, so they cost this server nothing.
 */

export const EXPLORE_REGION = "IN";
const LIST_TTL_MS = 6 * 60 * 60_000;
const DETAIL_TTL_MS = 12 * 60 * 60_000;
const STATIC_TTL_MS = 7 * 24 * 60 * 60_000; // genre names, service logos
const FAILED_TTL_MS = 60_000; // an outage is asked about again a minute later, not on every view
const MAX_CACHE_ENTRIES = 1500;
const MAX_IN_FLIGHT = 6;
const ROW_SIZE = 24;
const MIN_ROW_SIZE = 10;
const CAST_SIZE = 9;

/** The services offered as filters, in TMDb's own order of popularity in India. The ids are
 * TMDb's (`/watch/providers/movie?watch_region=IN`); names and logos are looked up from TMDb. */
export const EXPLORE_SERVICES = [
  { id: 8, name: "Netflix" },
  { id: 119, name: "Prime Video" },
  { id: 2336, name: "JioHotstar" },
  { id: 350, name: "Apple TV" },
  { id: 232, name: "Zee5" },
  { id: 237, name: "Sony Liv" },
] as const;
const SERVICE_IDS = new Set<number>(EXPLORE_SERVICES.map((s) => s.id));

/** Where a service's "Open" goes: its own search for the title where it has a stable search URL,
 * otherwise TMDb's where-to-watch page, whose links (from JustWatch) go to the title itself. */
const SERVICE_SEARCH: Record<number, (title: string) => string> = {
  8: (t) => `https://www.netflix.com/search?q=${encodeURIComponent(t)}`,
  119: (t) => `https://www.primevideo.com/search?phrase=${encodeURIComponent(t)}`,
  350: (t) => `https://tv.apple.com/search?term=${encodeURIComponent(t)}`,
  192: (t) => `https://www.youtube.com/results?search_query=${encodeURIComponent(t)}`,
};

export type ExploreKind = "all" | "movie" | "tv";
type TmdbType = "movie" | "tv";

export type ExploreItem = {
  tmdbType: TmdbType;
  tmdbId: string;
  title: string;
  year: number | null;
  rating: number | null;
  genres: string[];
  overview: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  /** Services the row itself was filtered by — only "Popular on Netflix"-style rows know this
   * without a call per title; the full list is in the title's details. */
  services: number[];
  inLibrary: TmdbSearchResult["inLibrary"];
};

export type ExploreRow = { id: string; title: string; items: ExploreItem[] };

export type ExploreService = { id: number; name: string; logoUrl: string | null };

export type ExploreOffer = { id: number; name: string; logoUrl: string | null; url: string };

export type ExploreDetail = Omit<ExploreItem, "services"> & {
  tagline: string | null;
  runtime: number | null;
  seasons: number | null;
  episodes: number | null;
  cast: { name: string; character: string | null; profileUrl: string | null }[];
  link: string;
  watch: { link: string | null; stream: ExploreOffer[]; free: ExploreOffer[]; rentBuy: ExploreOffer[] };
  existingRequest: TmdbSearchResult["existingRequest"];
};

// ---- The cache ------------------------------------------------------------------------------------

type CacheEntry = { at: number; ttl: number; value: Promise<unknown> };
const cache = new Map<string, CacheEntry>();
let inFlight = 0;
const waiting: (() => void)[] = [];

async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((resolve) => waiting.push(resolve));
  inFlight++;
  try {
    return await task();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

/** One TMDb GET, answered from the cache while it's fresh. Concurrent asks for the same thing
 * share one call. A failure (null) is kept only briefly. */
export function tmdbCached<T>(path: string, params: Record<string, string>, ttl: number): Promise<T | null> {
  const key = `${path}?${new URLSearchParams(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)))}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value as Promise<T | null>;

  const value = limited(() => tmdbFetch<T>(path, params));
  const entry: CacheEntry = { at: Date.now(), ttl, value };
  cache.delete(key);
  cache.set(key, entry);
  value.then((result) => {
    if (result === null && cache.get(key) === entry) entry.ttl = FAILED_TTL_MS;
  });
  // Map keeps insertion order, and every write re-inserts, so the first key is the stalest.
  while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  return value;
}

/** For the smoke test. */
export function clearExploreCache(): void {
  cache.clear();
}

// ---- TMDb shapes ----------------------------------------------------------------------------------

type TmdbListResult = {
  id: number;
  media_type?: string;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string | null;
  vote_average?: number;
  vote_count?: number;
  genre_ids?: number[];
  adult?: boolean;
};
type TmdbList = { results?: TmdbListResult[] };

type TmdbOffer = { provider_id: number; provider_name: string; logo_path?: string | null; display_priority?: number };
type TmdbDetail = TmdbListResult & {
  tagline?: string | null;
  runtime?: number | null;
  episode_run_time?: number[];
  number_of_seasons?: number | null;
  number_of_episodes?: number | null;
  genres?: { id: number; name: string }[];
  credits?: { cast?: { name: string; character?: string | null; profile_path?: string | null; order?: number }[] };
  "watch/providers"?: {
    results?: Record<string, { link?: string; flatrate?: TmdbOffer[]; free?: TmdbOffer[]; ads?: TmdbOffer[]; rent?: TmdbOffer[]; buy?: TmdbOffer[] }>;
  };
};

const image = (size: string, path: string | null | undefined) => (path ? `${env.tmdbImageBase}/${size}${path}` : null);
const yearOf = (date: string | undefined) => (date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null);
const ratingOf = (r: TmdbListResult) =>
  typeof r.vote_average === "number" && r.vote_average > 0 && (r.vote_count ?? 0) >= 5 ? Math.round(r.vote_average * 10) / 10 : null;

async function genreNames(): Promise<Map<number, string>> {
  const [movie, tv] = await Promise.all(
    (["movie", "tv"] as const).map((t) =>
      tmdbCached<{ genres?: { id: number; name: string }[] }>(`/genre/${t}/list`, { language: "en" }, STATIC_TTL_MS),
    ),
  );
  return new Map([...(movie?.genres ?? []), ...(tv?.genres ?? [])].map((g) => [g.id, g.name]));
}

export async function exploreServices(): Promise<ExploreService[]> {
  const list = await tmdbCached<{ results?: TmdbOffer[] }>(
    "/watch/providers/movie",
    { watch_region: EXPLORE_REGION },
    STATIC_TTL_MS,
  );
  const logos = new Map((list?.results ?? []).map((p) => [p.provider_id, p.logo_path]));
  return EXPLORE_SERVICES.map((s) => ({ id: s.id, name: s.name, logoUrl: image("w92", logos.get(s.id)) }));
}

// ---- Rows -----------------------------------------------------------------------------------------

/** One row is one or two TMDb lists — two when "All" needs a film list and a series list, which
 * are then interleaved so neither crowds the other out. */
type RowSource = { path: string; params?: Record<string, string>; type: TmdbType | "mixed" };
type RowSpec = { id: string; title: string; sources: RowSource[]; services?: number[] };

const thisYear = () => new Date().getFullYear();

function discover(type: TmdbType, params: Record<string, string>): RowSource {
  return { path: `/discover/${type}`, type, params: { include_adult: "false", ...params } };
}

/** Same query for films and series; the date field differs between them. */
function both(kind: ExploreKind, build: (type: TmdbType) => RowSource): RowSource[] {
  return kind === "all" ? [build("movie"), build("tv")] : [build(kind)];
}

const streamingIn = (ids: number[]) => ({
  watch_region: EXPLORE_REGION,
  with_watch_providers: ids.join("|"),
  with_watch_monetization_types: "flatrate|free|ads",
});

function rowsFor(kind: ExploreKind, services: number[]): RowSpec[] {
  const noun = kind === "movie" ? "films" : kind === "tv" ? "series" : "films and series";
  if (services.length) {
    const names = services.map((id) => EXPLORE_SERVICES.find((s) => s.id === id)!.name);
    const on = names.length > 2 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join(" and ");
    const where = streamingIn(services);
    // Badges only when one service is picked: with two, a title may be on either, not both.
    const badges = services.length === 1 ? services : [];
    return [
      { id: "popular", title: `Popular on ${on}`, services: badges, sources: both(kind, (t) => discover(t, { ...where, sort_by: "popularity.desc" })) },
      {
        id: "new",
        title: `New on ${on}`,
        services: badges,
        sources: both(kind, (t) =>
          discover(t, {
            ...where,
            sort_by: "popularity.desc",
            [t === "movie" ? "primary_release_date.gte" : "first_air_date.gte"]: `${thisYear() - 1}-01-01`,
          }),
        ),
      },
      {
        id: "rated",
        title: `Highest rated on ${on}`,
        services: badges,
        sources: both(kind, (t) =>
          discover(t, { ...where, sort_by: "vote_average.desc", "vote_count.gte": t === "movie" ? "1000" : "300" }),
        ),
      },
      {
        id: "hindi",
        title: `Hindi ${noun} on ${on}`,
        services: badges,
        sources: both(kind, (t) => discover(t, { ...where, with_original_language: "hi", sort_by: "popularity.desc" })),
      },
      {
        id: "south",
        title: `South Indian ${noun} on ${on}`,
        services: badges,
        sources: both(kind, (t) => discover(t, { ...where, with_original_language: "te|ta|ml|kn", sort_by: "popularity.desc" })),
      },
    ];
  }

  const popularOn = (id: number, name: string): RowSpec => ({
    id: `on-${id}`,
    title: `Popular on ${name}`,
    services: [id],
    sources: both(kind, (t) => discover(t, { ...streamingIn([id]), sort_by: "popularity.desc" })),
  });
  return [
    {
      id: "trending",
      title: "Trending this week",
      sources: [{ path: `/trending/${kind}/week`, type: kind === "all" ? "mixed" : kind }],
    },
    {
      id: "streaming",
      title: "Streaming in India right now",
      sources: both(kind, (t) => discover(t, { ...streamingIn(EXPLORE_SERVICES.map((s) => s.id)), sort_by: "popularity.desc" })),
    },
    {
      id: "hindi",
      title: `Hindi ${noun} everyone loves`,
      sources: both(kind, (t) =>
        discover(t, { with_original_language: "hi", sort_by: "vote_average.desc", "vote_count.gte": t === "movie" ? "300" : "60" }),
      ),
    },
    popularOn(8, "Netflix"),
    popularOn(119, "Prime Video"),
    popularOn(2336, "JioHotstar"),
    {
      id: "south",
      title: `South Indian ${noun} to start with`,
      sources: both(kind, (t) =>
        discover(t, {
          with_original_language: "te|ta|ml|kn",
          sort_by: "vote_average.desc",
          "vote_count.gte": t === "movie" ? "150" : "25",
        }),
      ),
    },
    {
      id: "new",
      title: `New ${kind === "tv" ? "series" : "releases"}`,
      sources: both(kind, (t) =>
        discover(t, {
          sort_by: "popularity.desc",
          "vote_count.gte": "50",
          [t === "movie" ? "primary_release_date.gte" : "first_air_date.gte"]: `${thisYear() - 1}-01-01`,
        }),
      ),
    },
    {
      id: "greats",
      title: "All-time greats",
      // Not TMDb's own /top_rated, which lets in brand-new titles on a handful of votes.
      sources: both(kind, (t) =>
        discover(t, { sort_by: "vote_average.desc", "vote_count.gte": t === "movie" ? "8000" : "2500" }),
      ),
    },
  ];
}

function toItem(r: TmdbListResult, type: TmdbType, genres: Map<number, string>, services: number[]) {
  const title = (r.title || r.name || "").trim();
  if (!title || r.adult) return null;
  return {
    tmdbType: type,
    tmdbId: String(r.id),
    title,
    year: yearOf(r.release_date || r.first_air_date),
    rating: ratingOf(r),
    genres: (r.genre_ids ?? []).map((id) => genres.get(id)).filter((g): g is string => Boolean(g)).slice(0, 3),
    overview: r.overview?.trim() || null,
    posterUrl: image("w342", r.poster_path),
    backdropUrl: image("w1280", r.backdrop_path),
    services,
  };
}

async function buildRow(spec: RowSpec, genres: Map<number, string>): Promise<Omit<ExploreItem, "inLibrary">[]> {
  const lists = await Promise.all(
    spec.sources.map(async (source) => {
      const list = await tmdbCached<TmdbList>(source.path, { language: "en-US", page: "1", ...source.params }, LIST_TTL_MS);
      return (list?.results ?? [])
        .map((r) => {
          const type = source.type === "mixed" ? r.media_type : source.type;
          return type === "movie" || type === "tv" ? toItem(r, type, genres, spec.services ?? []) : null;
        })
        // A poster row with no poster is a grey box; those are dropped.
        .filter((item): item is NonNullable<typeof item> => item !== null && item.posterUrl !== null);
    }),
  );
  const out: Omit<ExploreItem, "inLibrary">[] = [];
  const seen = new Set<string>();
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const list of lists) {
      const item = list[i];
      if (!item || seen.has(`${item.tmdbType}:${item.tmdbId}`)) continue;
      seen.add(`${item.tmdbType}:${item.tmdbId}`);
      out.push(item);
    }
  }
  return out;
}

export function parseExploreKind(value: unknown): ExploreKind {
  return value === "movie" || value === "tv" ? value : "all";
}

/** Only the services Explore offers, at most three, in a fixed order — so the same choice is
 * always the same cache key, and nobody can make it ask TMDb about arbitrary ids. */
export function parseExploreServices(value: unknown): number[] {
  const raw = typeof value === "string" ? value.split(",") : [];
  const picked = new Set(raw.map((v) => Number(v)).filter((id) => SERVICE_IDS.has(id)));
  return EXPLORE_SERVICES.map((s) => s.id).filter((id) => picked.has(id)).slice(0, 3);
}

/** The page: its rows, the filter services, and the hero pick. Null when TMDb didn't answer at
 * all (every row empty). */
export async function explorePage(
  kind: ExploreKind,
  services: number[],
  viewerId: string,
): Promise<{ rows: ExploreRow[]; services: ExploreService[]; featured: ExploreDetail | null } | null> {
  const genres = await genreNames();
  const specs = rowsFor(kind, services);
  const [built, serviceList] = await Promise.all([Promise.all(specs.map((spec) => buildRow(spec, genres))), exploreServices()]);
  if (built.every((items) => items.length === 0)) return null;

  // A title already in an earlier row is left out of later ones (the same hit show would
  // otherwise top half the rows); a row that would end up too thin keeps its repeats.
  const shown = new Set<string>();
  const deduped = built.map((items) => {
    const fresh = items.filter((item) => !shown.has(`${item.tmdbType}:${item.tmdbId}`));
    const row = (fresh.length >= MIN_ROW_SIZE ? fresh : items).slice(0, ROW_SIZE);
    for (const item of row) shown.add(`${item.tmdbType}:${item.tmdbId}`);
    return row;
  });
  const library = await libraryMatches(deduped.flat());
  const rows = specs
    .map((spec, i) => ({
      id: spec.id,
      title: spec.title,
      items: deduped[i].map((item) => ({ ...item, inLibrary: library.get(`${item.tmdbType}:${item.tmdbId}`) ?? null })),
    }))
    .filter((row) => row.items.length > 0);

  // The hero: from the first row, something well rated with a backdrop to put behind its name —
  // one pick per day, so it's the same for everyone that day and changes tomorrow.
  const candidates = (rows[0]?.items ?? []).filter((i) => i.backdropUrl && i.overview && (i.rating ?? 0) >= 6.5).slice(0, 10);
  const day = Math.floor(Date.now() / 86_400_000);
  const pick = candidates.length ? candidates[day % candidates.length] : null;
  const featured = pick ? await exploreDetail(pick.tmdbType, pick.tmdbId, viewerId) : null;

  return { rows, services: serviceList, featured };
}

// ---- The wall ------------------------------------------------------------------------------------

/** One poster on the fisheye wall — just enough to draw it and name it; everything else is a
 * click away (exploreDetail). Posters are TMDb paths; the client adds `imageBase` and a size. */
export type WallItem = {
  tmdbType: TmdbType;
  tmdbId: string;
  title: string;
  year: number | null;
  rating: number | null;
  genres: string[];
  posterPath: string;
  inCampfire: boolean;
};

const WALL_SIZE = 900;

/** The wall's sources, in the order they're dealt out: one from each in turn, so the middle of
 * the wall — what's on screen first — is a mix of this week's trending, what streams here, Hindi
 * and South Indian favourites and the all-time greats, rather than 60 of any one. */
function wallSources(kind: ExploreKind, services: number[]): { source: RowSource; pages: number }[] {
  const types: TmdbType[] = kind === "all" ? ["movie", "tv"] : [kind];
  const scale = kind === "all" ? 1 : 2; // one type gets both types' share of pages
  const out: { source: RowSource; pages: number }[] = [];
  const each = (pagesMovie: number, pagesTv: number, build: (t: TmdbType) => RowSource) => {
    for (const t of types) out.push({ source: build(t), pages: Math.min(20, (t === "movie" ? pagesMovie : pagesTv) * scale) });
  };
  if (services.length) {
    const where = streamingIn(services);
    each(10, 6, (t) => discover(t, { ...where, sort_by: "popularity.desc" }));
    each(4, 3, (t) => discover(t, { ...where, sort_by: "vote_average.desc", "vote_count.gte": t === "movie" ? "1000" : "300" }));
    each(3, 2, (t) => discover(t, { ...where, with_original_language: "hi", sort_by: "popularity.desc" }));
    each(3, 2, (t) => discover(t, { ...where, with_original_language: "te|ta|ml|kn", sort_by: "popularity.desc" }));
    return out;
  }
  out.push({ source: { path: `/trending/${kind}/week`, type: kind === "all" ? "mixed" : kind }, pages: 3 });
  each(6, 4, (t) => discover(t, { ...streamingIn(EXPLORE_SERVICES.map((s) => s.id)), sort_by: "popularity.desc" }));
  each(8, 5, (t) => discover(t, { sort_by: "popularity.desc", "vote_count.gte": t === "movie" ? "300" : "100" }));
  each(4, 2, (t) =>
    discover(t, { with_original_language: "hi", sort_by: "vote_count.desc", "vote_count.gte": t === "movie" ? "100" : "30" }),
  );
  each(3, 2, (t) =>
    discover(t, { with_original_language: "te|ta|ml|kn", sort_by: "vote_count.desc", "vote_count.gte": t === "movie" ? "80" : "20" }),
  );
  each(5, 3, (t) => discover(t, { sort_by: "vote_average.desc", "vote_count.gte": t === "movie" ? "3000" : "1000" }));
  return out;
}

export async function exploreWall(
  kind: ExploreKind,
  services: number[],
): Promise<{ items: WallItem[]; imageBase: string; services: ExploreService[] } | null> {
  const genres = await genreNames();
  const lists = await Promise.all(
    wallSources(kind, services).map(async ({ source, pages }) => {
      const results = await Promise.all(
        Array.from({ length: pages }, (_, i) =>
          tmdbCached<TmdbList>(source.path, { language: "en-US", page: String(i + 1), ...source.params }, LIST_TTL_MS),
        ),
      );
      return results.flatMap((list) =>
        (list?.results ?? []).flatMap((r) => {
          const type = source.type === "mixed" ? r.media_type : source.type;
          if (type !== "movie" && type !== "tv") return [];
          const item = toItem(r, type, genres, []);
          return item && r.poster_path ? [{ item, posterPath: r.poster_path }] : [];
        }),
      );
    }),
  );
  if (lists.every((l) => l.length === 0)) return null;

  const dealt: { item: Omit<ExploreItem, "inLibrary">; posterPath: string }[] = [];
  const seen = new Set<string>();
  for (let i = 0; dealt.length < WALL_SIZE && lists.some((l) => i < l.length); i++) {
    for (const list of lists) {
      const entry = list[i];
      if (!entry) continue;
      const key = `${entry.item.tmdbType}:${entry.item.tmdbId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dealt.push(entry);
    }
  }
  const items = dealt.slice(0, WALL_SIZE);
  const [library, serviceList] = await Promise.all([libraryMatches(items.map((e) => e.item)), exploreServices()]);
  return {
    imageBase: env.tmdbImageBase,
    services: serviceList,
    items: items.map(({ item, posterPath }) => ({
      tmdbType: item.tmdbType,
      tmdbId: item.tmdbId,
      title: item.title,
      year: item.year,
      rating: item.rating,
      genres: item.genres,
      posterPath,
      inCampfire: library.has(`${item.tmdbType}:${item.tmdbId}`),
    })),
  };
}

// ---- One title ------------------------------------------------------------------------------------

function offers(list: TmdbOffer[] | undefined, title: string, watchLink: string | null, fallback: string): ExploreOffer[] {
  return [...(list ?? [])]
    .sort((a, b) => (a.display_priority ?? 999) - (b.display_priority ?? 999))
    .map((o) => ({
      id: o.provider_id,
      name: EXPLORE_SERVICES.find((s) => s.id === o.provider_id)?.name ?? o.provider_name,
      logoUrl: image("w92", o.logo_path),
      url: SERVICE_SEARCH[o.provider_id]?.(title) ?? watchLink ?? fallback,
    }));
}

const dedupe = (list: ExploreOffer[], already: Set<number>) =>
  list.filter((o) => (already.has(o.id) ? false : (already.add(o.id), true)));

export function isTmdbId(value: string): boolean {
  return /^\d{1,10}$/.test(value);
}

export async function exploreDetail(type: TmdbType, tmdbId: string, viewerId: string): Promise<ExploreDetail | null> {
  if (!isTmdbId(tmdbId)) return null;
  const raw = await tmdbCached<TmdbDetail>(
    `/${type}/${tmdbId}`,
    { language: "en-US", append_to_response: "credits,watch/providers" },
    DETAIL_TTL_MS,
  );
  if (!raw || !(raw.title || raw.name)) return null;

  const title = (raw.title || raw.name || "").trim();
  const link = `https://www.themoviedb.org/${type}/${tmdbId}`;
  const region = raw["watch/providers"]?.results?.[EXPLORE_REGION];
  const watchLink = region?.link ?? null;
  const fallback = `${link}/watch?locale=${EXPLORE_REGION}`;
  const seen = new Set<number>();
  // "JustWatch TV Beta" and the like are listings, not somewhere to watch.
  // "Amazon Prime Video with Ads" next to Prime Video is the same service twice.
  const everyName = [region?.flatrate, region?.free, region?.ads, region?.rent, region?.buy].flat().map((o) => o?.provider_name);
  const real = (list: TmdbOffer[] | undefined) =>
    list?.filter((o) => {
      if (/justwatch/i.test(o.provider_name)) return false;
      const base = o.provider_name.replace(/\s+with ads$/i, "");
      return base === o.provider_name || !everyName.includes(base);
    });
  const stream = dedupe(offers(real(region?.flatrate), title, watchLink, fallback), seen);
  const free = dedupe(offers(real([...(region?.free ?? []), ...(region?.ads ?? [])]), title, watchLink, fallback), seen);
  const rentBuy = dedupe(offers(real([...(region?.rent ?? []), ...(region?.buy ?? [])]), title, watchLink, fallback), seen);

  const [library, requests] = await Promise.all([libraryMatches([{ tmdbType: type, tmdbId }]), requestMatches([tmdbId], viewerId)]);
  const key = `${type}:${tmdbId}`;

  return {
    tmdbType: type,
    tmdbId,
    title,
    year: yearOf(raw.release_date || raw.first_air_date),
    rating: ratingOf(raw),
    genres: (raw.genres ?? []).map((g) => g.name).slice(0, 4),
    overview: raw.overview?.trim() || null,
    posterUrl: image("w342", raw.poster_path),
    backdropUrl: image("w1280", raw.backdrop_path),
    tagline: raw.tagline?.trim() || null,
    runtime: raw.runtime || raw.episode_run_time?.[0] || null,
    seasons: type === "tv" ? (raw.number_of_seasons ?? null) : null,
    episodes: type === "tv" ? (raw.number_of_episodes ?? null) : null,
    cast: (raw.credits?.cast ?? [])
      .slice()
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
      .slice(0, CAST_SIZE)
      .map((c) => ({ name: c.name, character: c.character?.trim() || null, profileUrl: image("w185", c.profile_path) })),
    link,
    watch: { link: watchLink, stream, free, rentBuy },
    inLibrary: library.get(key) ?? null,
    existingRequest: requests.get(key) ?? null,
  };
}
