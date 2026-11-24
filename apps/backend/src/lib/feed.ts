import { getDb } from "./mongodb";
import {
  both,
  buildRow,
  discover,
  EXPLORE_SERVICES,
  genreNames,
  logoFrom,
  streamingIn,
  tmdbCached,
  type ExploreItem,
  type ExploreKind,
  type RowSource,
  type RowSpec,
  type TmdbLogo,
  type TmdbType,
} from "./explore";
import { libraryMatches } from "./tmdbSearch";

/**
 * Home's feed: all of TMDb in sections — today's top ten, what's hot, trending and in cinemas, what
 * each service has, languages, genres, eras — whether or not the library has a title. Sections come
 * a page at a time as the viewer scrolls, and each can be opened on its own and scrolled without
 * end.
 *
 * The feed is made once a day, by the first viewer to open it that day (India's), and everyone gets
 * that copy until the next. It's kept in Mongo, so a restart doesn't make it again, and the last good
 * copy stands in when TMDb isn't answering. What's in the library is added to it on every read.
 */

export const SECTIONS_PER_PAGE = 6;
const HERO_SIZE = 7;
const TOP_SIZE = 10;
/** TMDb's own limit on any list. */
const MAX_LIST_PAGE = 500;
const LIST_TTL_MS = 6 * 60 * 60_000;
const IMAGES_TTL_MS = 24 * 60 * 60_000;

/** How a section's cards look: posters, wide stills, or posters with big rank numbers. */
export type SectionLook = "poster" | "wide" | "rank";
type Section = Omit<RowSpec, "services"> & { look?: SectionLook; services?: number[] };

export type FeedSection = { id: string; title: string; look: SectionLook; items: ExploreItem[] };

export type FeedHeroItem = ExploreItem & { logoUrl: string | null };

const DAY_MS = 86_400_000;
const day = (offset = 0) => new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);
const dateField = (t: TmdbType) => (t === "movie" ? "primary_release_date" : "first_air_date");
/** Enough votes to mean something; far fewer people rate series. */
const votes = (t: TmdbType, movie: number, tv: number) => ({ "vote_count.gte": String(t === "movie" ? movie : tv) });

/** A genre's section; a genre TMDb has only for films isn't there for series. */
function genre(kind: ExploreKind, id: string, title: string, movie: number | null, tv: number | null): Section[] {
  const ids = { movie, tv };
  const types = (kind === "all" ? (["movie", "tv"] as const) : [kind]).filter((t) => ids[t] !== null);
  if (types.length === 0) return [];
  return [
    {
      id,
      title,
      sources: types.map((t) =>
        discover(t, { with_genres: String(ids[t]), sort_by: "popularity.desc", ...votes(t, 200, 60) }),
      ),
    },
  ];
}

function language(kind: ExploreKind, id: string, title: string, code: string, extra: Record<string, string> = {}): Section {
  return {
    id,
    title,
    sources: both(kind, (t) => discover(t, { with_original_language: code, sort_by: "popularity.desc", ...votes(t, 20, 8), ...extra })),
  };
}

function service(kind: ExploreKind, id: number, name: string): Section {
  return {
    id: `on-${id}`,
    title: `Popular on ${name}`,
    services: [id],
    sources: both(kind, (t) => discover(t, { ...streamingIn([id]), sort_by: "popularity.desc" })),
  };
}

function era(kind: ExploreKind, id: string, title: string, from: number, to: number): Section {
  return {
    id,
    title,
    sources: both(kind, (t) =>
      discover(t, {
        [`${dateField(t)}.gte`]: `${from}-01-01`,
        [`${dateField(t)}.lte`]: `${to}-12-31`,
        sort_by: "vote_count.desc",
      }),
    ),
  };
}

const trending = (kind: ExploreKind, window: "day" | "week"): RowSource => ({
  path: `/trending/${kind}/${window}`,
  type: kind === "all" ? "mixed" : kind,
});

/** Every section, in order. */
function sections(kind: ExploreKind): Section[] {
  const what = kind === "movie" ? "films" : kind === "tv" ? "series" : "films and series";
  const films = kind !== "tv";
  const series = kind !== "movie";
  const when = <T>(condition: boolean, ...list: T[]) => (condition ? list : []);
  const [netflix, prime, hotstar, apple, zee5, sony] = EXPLORE_SERVICES;
  return [
    { id: "top", title: `Top ${TOP_SIZE} today`, look: "rank", sources: [trending(kind, "day")] },
    {
      id: "hot",
      title: "New and hot",
      look: "wide",
      sources: both(kind, (t) =>
        discover(t, {
          [`${dateField(t)}.gte`]: day(-150),
          [`${dateField(t)}.lte`]: day(),
          sort_by: "popularity.desc",
          ...votes(t, 20, 8),
        }),
      ),
    },
    { id: "trending", title: "Trending this week", sources: [trending(kind, "week")] },
    {
      id: "streaming",
      title: "Streaming in India now",
      sources: both(kind, (t) =>
        discover(t, { ...streamingIn(EXPLORE_SERVICES.map((s) => s.id)), sort_by: "popularity.desc" }),
      ),
    },
    ...when<Section>(films, {
      id: "cinemas",
      title: "In cinemas now",
      look: "wide",
      sources: [{ path: "/movie/now_playing", params: { region: "IN" }, type: "movie" }],
    }),
    language(kind, "hindi", `Hindi ${what}`, "hi"),
    ...when<Section>(series, {
      id: "airing",
      title: "New episodes this week",
      sources: [{ path: "/tv/on_the_air", type: "tv" }],
    }),
    service(kind, netflix.id, netflix.name),
    ...genre(kind, "action", "Action and adventure", 28, 10759),
    language(kind, "south", `South Indian ${what}`, "te|ta|ml|kn"),
    {
      id: "acclaimed",
      title: "Critically acclaimed",
      look: "wide",
      sources: both(kind, (t) => discover(t, { sort_by: "vote_average.desc", ...votes(t, 5000, 1500) })),
    },
    service(kind, prime.id, prime.name),
    ...genre(kind, "comedy", "Comedies", 35, 35),
    language(kind, "korean", kind === "movie" ? "Korean cinema" : "Korean dramas and films", "ko"),
    ...genre(kind, "thriller", "Edge-of-your-seat thrillers", 53, null),
    ...genre(kind, "crime", "Crime", 80, 80),
    service(kind, hotstar.id, hotstar.name),
    ...genre(kind, "scifi", "Science fiction and fantasy", 878, 10765),
    ...when<Section>(films, {
      id: "coming",
      title: "Coming soon",
      look: "wide",
      sources: [
        discover("movie", {
          region: "IN",
          "primary_release_date.gte": day(1),
          "primary_release_date.lte": day(240),
          sort_by: "popularity.desc",
        }),
      ],
    }),
    ...genre(kind, "romance", "Romance", 10749, null),
    language(kind, "anime", "Anime", "ja", { with_genres: "16" }),
    ...genre(kind, "horror", "Horror", 27, null),
    service(kind, apple.id, apple.name),
    ...genre(kind, "drama", "Dramas to get lost in", 18, 18),
    {
      id: "gems",
      title: "Hidden gems",
      sources: both(kind, (t) =>
        discover(t, {
          sort_by: "vote_average.desc",
          "vote_count.gte": t === "movie" ? "250" : "80",
          "vote_count.lte": t === "movie" ? "1200" : "350",
        }),
      ),
    },
    ...genre(kind, "family", "Family night", 10751, 10751),
    ...when<Section>(films, {
      id: "blockbusters",
      title: "Biggest blockbusters",
      look: "wide",
      sources: [discover("movie", { sort_by: "revenue.desc" })],
    }),
    ...genre(kind, "mystery", "Mysteries", 9648, 9648),
    ...when<Section>(series, {
      id: "mini",
      title: "Mini-series to finish this weekend",
      sources: [discover("tv", { with_type: "2", sort_by: "popularity.desc", "vote_count.gte": "100" })],
    }),
    service(kind, zee5.id, zee5.name),
    ...genre(kind, "animation", "Animation", 16, 16),
    ...when<Section>(films, {
      id: "short",
      title: "Under 90 minutes",
      sources: [discover("movie", { "with_runtime.gte": "60", "with_runtime.lte": "90", sort_by: "popularity.desc", "vote_count.gte": "500" })],
    }),
    language(kind, "spanish", "From Spain and Latin America", "es"),
    ...genre(kind, "war", "War and history", 10752, 10768),
    service(kind, sony.id, sony.name),
    ...genre(kind, "documentary", "Documentaries", 99, 99),
    era(kind, "nineties", "Best of the nineties", 1990, 1999),
    ...when<Section>(films, { id: "music", title: "Music and musicals", sources: [discover("movie", { with_genres: "10402", sort_by: "popularity.desc", "vote_count.gte": "150" })] }),
    era(kind, "noughties", "Best of the 2000s", 2000, 2009),
    ...when<Section>(films, era("movie", "classics", "Golden age classics", 1930, 1969)),
  ];
}

async function withLibrary(lists: Item[][]): Promise<ExploreItem[][]> {
  const library = await libraryMatches(lists.flat());
  return lists.map((items) =>
    items.map((item) => ({ ...item, inLibrary: library.get(`${item.tmdbType}:${item.tmdbId}`) ?? null })),
  );
}

/** The hero: what most people are watching today, with something to fill the screen with. */
async function hero(kind: ExploreKind): Promise<StoredPage["hero"]> {
  const spec: RowSpec = { id: "hero", title: "", sources: [trending(kind, "day")] };
  const picks = (await buildRow(spec, await genreNames())).filter((i) => i.backdropUrl && i.overview).slice(0, HERO_SIZE);
  const logos = await Promise.all(picks.map((i) => logoOf(i.tmdbType, i.tmdbId)));
  return picks.map((item, i) => ({ ...item, logoUrl: logos[i] }));
}

async function logoOf(type: TmdbType, id: string): Promise<string | null> {
  const found = await tmdbCached<{ logos?: TmdbLogo[] }>(
    `/${type}/${id}/images`,
    { include_image_language: "en,null" },
    IMAGES_TTL_MS,
  );
  return logoFrom(found?.logos);
}

type Item = Omit<ExploreItem, "inLibrary">;
type StoredPage = {
  hero: (Item & { logoUrl: string | null })[];
  sections: { id: string; title: string; look: SectionLook; items: Item[] }[];
  next: number | null;
};
type PageDoc = { _id: string; day: string; page: StoredPage; at: Date };

const KEEP_DAYS = 7;
const feedDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

async function pages() {
  return (await getDb()).collection<PageDoc>("feedPages");
}

export async function ensureIndexes(): Promise<void> {
  await (await pages()).createIndex({ at: 1 }, { expireAfterSeconds: KEEP_DAYS * 24 * 60 * 60 });
}

async function makePage(kind: ExploreKind, page: number): Promise<{ stored: StoredPage; complete: boolean } | null> {
  const all = sections(kind);
  const wanted = all.slice(page * SECTIONS_PER_PAGE, (page + 1) * SECTIONS_PER_PAGE);
  const genres = await genreNames();
  const [lists, heroItems] = await Promise.all([
    Promise.all(wanted.map((s) => buildRow(s, genres))),
    page === 0 ? hero(kind) : Promise.resolve([]),
  ]);
  if (wanted.length > 0 && lists.every((l) => l.length === 0)) return null;
  return {
    complete: lists.every((l) => l.length > 0) && (page > 0 || heroItems.length > 0),
    stored: {
      hero: heroItems,
      sections: wanted
        .map((s, i) => ({
          id: s.id,
          title: s.title,
          look: s.look ?? ("poster" as const),
          items: s.look === "rank" ? lists[i].slice(0, TOP_SIZE) : lists[i],
        }))
        .filter((s) => s.items.length > 0),
      next: (page + 1) * SECTIONS_PER_PAGE < all.length ? page + 1 : null,
    },
  };
}

/** Today's copy of a page: the one already made, else made now. */
async function todaysPage(kind: ExploreKind, page: number): Promise<StoredPage | null> {
  const day = feedDay();
  const _id = `${kind}:${page}`;
  const col = await pages();
  const last = await col.findOne({ _id });
  if (last?.day === day) return last.page;
  const made = await makePage(kind, page);
  // With a section missing it's shown, but tried again on the next open.
  if (made?.complete) {
    await col.updateOne({ _id }, { $set: { day, page: made.stored, at: new Date() } }, { upsert: true });
    return made.stored;
  }
  return last?.page ?? made?.stored ?? null;
}

// Several viewers opening it at once wait for one copy.
const making = new Map<string, Promise<StoredPage | null>>();

/** One page of sections, with the hero on the first. Null when TMDb isn't answering and there's no
 * copy of it. A title can be in several sections; the client leaves out repeats, knowing which pages
 * it has shown. */
export async function feedPage(kind: ExploreKind, page: number) {
  const key = `${kind}:${page}`;
  let copy = making.get(key);
  if (!copy) {
    copy = todaysPage(kind, page).finally(() => making.delete(key));
    making.set(key, copy);
  }
  const stored = await copy;
  if (!stored) return null;
  const [heroItems, ...lists] = await withLibrary([stored.hero, ...stored.sections.map((s) => s.items)]);
  return {
    hero: heroItems.map((item, i): FeedHeroItem => ({ ...item, logoUrl: stored.hero[i].logoUrl })),
    sections: stored.sections.map((s, i): FeedSection => ({ ...s, items: lists[i] })),
    next: stored.next,
  };
}

/** One section on its own, a page at a time. Undefined when there's no such section; null when TMDb
 * didn't answer. */
export async function feedSection(kind: ExploreKind, id: string, page: number) {
  const section = sections(kind).find((s) => s.id === id);
  if (!section) return undefined;
  const totals = await Promise.all(
    section.sources.map((s) =>
      tmdbCached<{ total_pages?: number }>(s.path, { language: "en-US", page: String(page), ...s.params }, LIST_TTL_MS),
    ),
  );
  if (totals.every((t) => t === null)) return null;
  const last = Math.min(MAX_LIST_PAGE, Math.max(...totals.map((t) => t?.total_pages ?? 0)));
  const [items] = await withLibrary([await buildRow(section, await genreNames(), page)]);
  return { title: section.title, items, next: page < last ? page + 1 : null };
}
