import { getDb } from "./mongodb";
import type { WatchProgress } from "./progress";
import { tmdbRefOf } from "./tmdbRef";
import type { ArtworkFields } from "./artwork";

/** What a viewer says about a title: that they've watched it, and whether they liked it. Kept per
 * film or whole series by TMDb id, so anything on TMDb can be rated, in the library or not, and a
 * replaced file keeps its rating. A film played to its end counts as watched without being told. */

export type TitleType = "movie" | "tv";
export type Rating = "like" | "dislike";
export type Opinion = { type: TitleType; id: string; watched: boolean; rating: Rating | null };

type OpinionDoc = {
  _id: string; // `${userId}|${type}:${id}`
  userId: string;
  type: TitleType;
  id: string;
  /** Null until the viewer sets it. */
  watched: boolean | null;
  watchedAt: Date | null;
  rating: Rating | null;
  updatedAt: Date;
};

/** A title the viewer has played something of, newest first. */
type Played = { type: TitleType; id: string; finished: boolean; at: Date };

/** Everything known about what a viewer has seen, by title key ("movie:603"). */
export type ViewerTitles = {
  opinions: Map<string, Opinion & { at: Date }>;
  played: Map<string, Played>;
};

export type OpinionChange = { watched?: boolean; rating?: Rating | null };

const MAX_PROGRESS = 1000;

export const titleKey = (type: TitleType, id: string) => `${type}:${id}`;

async function collection() {
  return (await getDb()).collection<OpinionDoc>("titleOpinions");
}

export async function ensureIndexes(): Promise<void> {
  await (await collection()).createIndex({ userId: 1 });
}

type CatalogRow = { _id: string } & Pick<ArtworkFields, "artwork" | "episodeArtwork">;

/** The titles behind the viewer's watch progress; an episode counts towards its series. */
async function playedTitles(userId: string): Promise<Map<string, Played>> {
  const db = await getDb();
  const progress = await db
    .collection<WatchProgress>("watchProgress")
    .find({ userId, $or: [{ completed: true }, { positionSeconds: { $gt: 0 } }] }, { projection: { fileId: 1, completed: 1, updatedAt: 1 } })
    .sort({ updatedAt: -1 })
    .limit(MAX_PROGRESS)
    .toArray();
  const videos = await db
    .collection<CatalogRow>("catalogVideos")
    .find(
      { _id: { $in: progress.map((p) => p.fileId) } },
      { projection: { "artwork.tmdbType": 1, "artwork.tmdbId": 1, "episodeArtwork.seriesTmdbId": 1 } },
    )
    .toArray();
  const byId = new Map(videos.map((v) => [v._id, v]));
  const played = new Map<string, Played>();
  for (const p of progress) {
    const video = byId.get(p.fileId);
    const ref = video ? tmdbRefOf(video) : null;
    if (!ref) continue;
    const key = titleKey(ref.type, ref.id);
    // One finished episode isn't a finished series.
    const finished = p.completed && ref.type === "movie";
    const known = played.get(key);
    if (known) known.finished ||= finished;
    else played.set(key, { type: ref.type, id: ref.id, finished, at: p.updatedAt });
  }
  return played;
}

/** The viewer's own word, unless they've finished the film again since saying otherwise. */
function isWatched(doc: Pick<OpinionDoc, "watched" | "watchedAt"> | undefined, played: Played | undefined): boolean {
  if (doc?.watched) return true;
  if (!played?.finished) return false;
  return doc?.watched !== false || (doc.watchedAt !== null && played.at > doc.watchedAt);
}

export async function viewerTitles(userId: string): Promise<ViewerTitles> {
  const [docs, played] = await Promise.all([(await collection()).find({ userId }).toArray(), playedTitles(userId)]);
  const opinions: ViewerTitles["opinions"] = new Map();
  for (const d of docs) {
    const key = titleKey(d.type, d.id);
    opinions.set(key, { type: d.type, id: d.id, watched: isWatched(d, played.get(key)), rating: d.rating, at: d.updatedAt });
  }
  for (const [key, p] of played) {
    if (p.finished && !opinions.has(key)) opinions.set(key, { type: p.type, id: p.id, watched: true, rating: null, at: p.at });
  }
  return { opinions, played };
}

export async function listOpinions(userId: string): Promise<Opinion[]> {
  const { opinions } = await viewerTitles(userId);
  return [...opinions.values()].map(({ type, id, watched, rating }) => ({ type, id, watched, rating }));
}

/** Titles the viewer has no use for a suggestion of: seen, rated, or told it isn't for them. */
export async function settledTitles(userId: string): Promise<Set<string>> {
  const { opinions } = await viewerTitles(userId);
  return new Set([...opinions].filter(([, o]) => o.watched || o.rating).map(([key]) => key));
}

/** Titles marked watched by hand, with when — what Continue watching then leaves out. */
export async function markedWatched(userId: string): Promise<Map<string, Date>> {
  const docs = await (await collection()).find({ userId, watched: true }).toArray();
  return new Map(docs.map((d) => [titleKey(d.type, d.id), d.watchedAt ?? d.updatedAt]));
}

/** A change from a request body, or null when it isn't one. */
export function parseOpinionChange(raw: unknown): OpinionChange | null {
  const { watched, rating } = (raw ?? {}) as Record<string, unknown>;
  if (watched !== undefined && typeof watched !== "boolean") return null;
  if (rating !== undefined && rating !== null && rating !== "like" && rating !== "dislike") return null;
  if (watched === undefined && rating === undefined) return null;
  return { watched, rating };
}

export async function setOpinion(userId: string, type: TitleType, id: string, change: OpinionChange): Promise<void> {
  const now = new Date();
  const _id = `${userId}|${titleKey(type, id)}`;
  const set: Partial<OpinionDoc> = { updatedAt: now };
  if (change.watched !== undefined) Object.assign(set, { watched: change.watched, watchedAt: now });
  if (change.rating !== undefined) set.rating = change.rating;
  const defaults: Partial<OpinionDoc> = { userId, type, id };
  if (change.watched === undefined) Object.assign(defaults, { watched: null, watchedAt: null });
  if (change.rating === undefined) defaults.rating = null;
  const col = await collection();
  await col.updateOne({ _id }, { $set: set, $setOnInsert: defaults }, { upsert: true });
  // Nothing left to say: gone, so a film finished later counts as watched again.
  await col.deleteOne({ _id, watched: null, rating: null });
}
