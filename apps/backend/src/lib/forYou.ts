import { env } from "../config/env";
import { listPublishedFoldersByParent } from "./catalogFolders";
import { listPublishedVideosByParent } from "./catalogVideos";
import { tmdbTitleFacts, tmdbRecommendations, type ExploreItem } from "./explore";
import { titleKey, viewerTitles, type TitleType } from "./opinions";
import type { CatalogArtwork } from "./artwork";

/**
 * "For you": what to watch next, from what the viewer has liked, disliked and watched
 * (lib/opinions.ts). Two lists — titles in the library, and ones on TMDb that aren't.
 *
 * Every title the viewer has an opinion on counts for its genres and lead actors: a like for most, a
 * dislike against. A candidate is scored by how its own compare, plus TMDb's "people who liked this
 * also liked" from the viewer's favourites. Anything already seen, rated or under way is left out.
 */

const LIKE = 3;
const WATCHED = 1;
const STARTED = 0.5;
const DISLIKE = -3;
/** Titles outside the library need a (cached) TMDb call each to know their genres and cast. */
const MAX_OUTSIDE_FACTS = 24;
const MAX_SEEDS = 6;
const LIST_SIZE = 18;
const LEADS = 6;

type Facts = { title: string; genres: string[]; cast: string[] };
type Signal = { key: string; type: TitleType; id: string; weight: number; at: Date };

export type ForYou = {
  /** False until the viewer has liked or watched something. */
  ready: boolean;
  library: { kind: "folder" | "video"; id: string; reason: string | null }[];
  explore: (ExploreItem & { reason: string | null })[];
};

/** TMDb names the genres of series differently; these make them one list. */
const GENRE_PARTS: Record<string, string[]> = {
  "Action & Adventure": ["Action", "Adventure"],
  "Sci-Fi & Fantasy": ["Science Fiction", "Fantasy"],
  "War & Politics": ["War"],
};
const genresOf = (names: string[]) => [...new Set(names.flatMap((g) => GENRE_PARTS[g] ?? [g]))];

const factsOf = (artwork: CatalogArtwork): Facts => ({
  title: artwork.title,
  genres: genresOf(artwork.genres ?? []),
  cast: (artwork.cast ?? []).slice(0, LEADS).map((c) => c.name),
});

/** How a viewer takes to each genre or actor, from -1 to 1: an average that stays small until
 * there's enough behind it. */
function affinities(entries: { values: string[]; weight: number }[]): Map<string, number> {
  const sums = new Map<string, { sum: number; size: number }>();
  for (const { values, weight } of entries) {
    for (const value of values) {
      const s = sums.get(value) ?? { sum: 0, size: 0 };
      sums.set(value, { sum: s.sum + weight, size: s.size + Math.abs(weight) });
    }
  }
  return new Map([...sums].map(([value, { sum, size }]) => [value, sum / (size + 2)]));
}

async function viewerSignals(userId: string) {
  const { opinions, played } = await viewerTitles(userId);
  const signals: Signal[] = [];
  for (const [key, o] of opinions) {
    const weight = o.rating === "like" ? LIKE : o.rating === "dislike" ? DISLIKE : o.watched ? WATCHED : 0;
    if (weight) signals.push({ key, type: o.type, id: o.id, weight, at: o.at });
  }
  for (const [key, p] of played) {
    if (!opinions.has(key)) signals.push({ key, type: p.type, id: p.id, weight: STARTED, at: p.at });
  }
  // The strongest feelings first, the latest of those first.
  signals.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight) || b.at.getTime() - a.at.getTime());
  return { signals, settled: new Set([...opinions].filter(([, o]) => o.watched || o.rating).map(([k]) => k)), played };
}

export async function forYou(userId: string): Promise<ForYou> {
  const { signals, settled, played } = await viewerSignals(userId);
  if (!signals.some((s) => s.weight > 0)) return { ready: false, library: [], explore: [] };

  const [folders, videos] = await Promise.all([
    listPublishedFoldersByParent(env.driveRootFolderId),
    listPublishedVideosByParent(env.driveRootFolderId),
  ]);
  const shelf = [
    ...folders.map((f) => ({ kind: "folder" as const, id: f._id, artwork: f.artwork })),
    ...videos.map((v) => ({ kind: "video" as const, id: v._id, artwork: v.artwork })),
  ].flatMap((t) => (t.artwork ? [{ ...t, artwork: t.artwork, key: titleKey(t.artwork.tmdbType, t.artwork.tmdbId) }] : []));

  // ---- The viewer's taste ----
  const facts = new Map<string, Facts>(shelf.map((t) => [t.key, factsOf(t.artwork)]));
  const outside = signals.filter((s) => !facts.has(s.key)).slice(0, MAX_OUTSIDE_FACTS);
  await Promise.all(
    outside.map(async (s) => {
      const found = await tmdbTitleFacts(s.type, s.id);
      if (found) facts.set(s.key, { ...found, genres: genresOf(found.genres), cast: found.cast.slice(0, LEADS) });
    }),
  );
  const known = signals.flatMap((s) => (facts.has(s.key) ? [{ ...s, facts: facts.get(s.key)! }] : []));
  const genreTaste = affinities(known.map((s) => ({ values: s.facts.genres, weight: s.weight })));
  const castTaste = affinities(known.map((s) => ({ values: s.facts.cast, weight: s.weight })));

  // ---- "People who liked this also liked" ----
  const seeds = signals.filter((s) => s.weight >= WATCHED).slice(0, MAX_SEEDS);
  const recommended = new Map<string, { item: Omit<ExploreItem, "inLibrary">; score: number; because: string }>();
  const lists = await Promise.all(seeds.map((s) => tmdbRecommendations(s.type, s.id)));
  for (const [i, seed] of seeds.entries()) {
    const title = facts.get(seed.key)?.title;
    if (!title) continue;
    const because = `Because you ${seed.weight >= LIKE ? "liked" : "watched"} ${title}`;
    for (const item of lists[i]) {
      const key = titleKey(item.tmdbType, item.tmdbId);
      const before = recommended.get(key);
      if (before) before.score += seed.weight / LIKE;
      else recommended.set(key, { item, score: seed.weight / LIKE, because });
    }
  }

  const score = (key: string, genres: string[], cast: string[], average: number | null) => {
    const genre = genres.length ? genres.reduce((sum, g) => sum + (genreTaste.get(g) ?? 0), 0) / genres.length : 0;
    const people = cast.reduce((sum, name) => sum + (castTaste.get(name) ?? 0), 0);
    const also = Math.min(recommended.get(key)?.score ?? 0, 3);
    const taste = genre * 3 + Math.max(-1.5, Math.min(1.5, people)) + also;
    const lead = cast.find((name) => (castTaste.get(name) ?? 0) > 0.2);
    const genreLiked = genres
      .filter((g) => (genreTaste.get(g) ?? 0) > 0)
      .sort((a, b) => genreTaste.get(b)! - genreTaste.get(a)!)[0];
    const reason = recommended.get(key)?.because ?? (lead ? `With ${lead}` : genreLiked ? `You like ${genreLiked}` : null);
    return { taste, total: taste + (average ?? 0) / 10, reason };
  };
  const best = <T extends { taste: number; total: number }>(list: T[]) =>
    // What the viewer tends to dislike isn't a suggestion, however well rated.
    list.filter((c) => c.taste > 0).sort((a, b) => b.total - a.total).slice(0, LIST_SIZE);
  const isNew = (key: string) => !settled.has(key) && !played.has(key);

  const seen = new Set<string>();
  const library = best(
    shelf
      .filter((t) => isNew(t.key) && !seen.has(t.key) && seen.add(t.key))
      .map((t) => {
        const f = facts.get(t.key)!;
        return { kind: t.kind, id: t.id, ...score(t.key, f.genres, f.cast, t.artwork.rating?.average ?? null) };
      }),
  ).map(({ kind, id, reason }) => ({ kind, id, reason }));

  const onShelf = new Set(shelf.map((t) => t.key));
  const explore = best(
    [...recommended]
      .filter(([key]) => isNew(key) && !onShelf.has(key))
      .map(([key, { item }]) => ({ item, ...score(key, genresOf(item.genres), [], item.rating) })),
  ).map(({ item, reason }) => ({ ...item, inLibrary: null, reason }));

  return { ready: true, library, explore };
}
