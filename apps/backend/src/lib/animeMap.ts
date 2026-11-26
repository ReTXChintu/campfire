import { env } from "../config/env";
import { getDb } from "./mongodb";

/**
 * Which AniList entries a TMDb title is, from Fribb/anime-lists (github.com/Fribb/anime-lists): an
 * automatic weekly merge of anime-offline-database and Anime-Lists that ties each AniList entry to
 * its TMDb id and, for a series, to the TMDb season it is and where in that season it starts. Read
 * from GitHub once a week into Mongo, so finding a title's entries costs AniList nothing. It's only
 * a starting point: lib/anilistLink.ts checks every link against episode counts and air dates.
 */

export type MapEntry = {
  anilistId: number;
  tmdbType: "movie" | "tv";
  tmdbId: string;
  /** The TMDb season it is; null when it runs across the whole series (One Piece), 0 for specials. */
  season: number | null;
  /** TMDb episodes in that season before its first. */
  offset: number;
  malId: number | null;
};

type MapDoc = MapEntry & { _id: string; seenAt: Date };
type MetaDoc = { _id: string; at: Date; count: number };

const REFRESH_MS = 7 * 24 * 60 * 60_000;
const CHECK_EVERY_MS = 12 * 60 * 60_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const META_ID = "map";

async function entries() {
  return (await getDb()).collection<MapDoc>("animeMap");
}
async function meta() {
  return (await getDb()).collection<MetaDoc>("animeMapMeta");
}

export async function ensureIndexes(): Promise<void> {
  await (await entries()).createIndex({ tmdbType: 1, tmdbId: 1 });
  await (await entries()).createIndex({ anilistId: 1 });
}

type RawEntry = {
  anilist_id?: unknown;
  mal_id?: unknown;
  themoviedb_id?: unknown;
  season?: unknown;
  episode_offset?: unknown;
};

const positiveInt = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);
const tmdbField = (v: unknown) =>
  v && typeof v === "object" && typeof (v as { tmdb?: unknown }).tmdb === "number" ? (v as { tmdb: number }).tmdb : null;

/** The file's rows as entries; one per TMDb id the row names. Exported for the smoke test. */
export function parseMapFile(rows: unknown): MapEntry[] {
  if (!Array.isArray(rows)) return [];
  const out: MapEntry[] = [];
  for (const row of rows as RawEntry[]) {
    const anilistId = positiveInt(row?.anilist_id);
    const tmdb = row?.themoviedb_id;
    if (!anilistId || !tmdb || typeof tmdb !== "object") continue;
    for (const type of ["tv", "movie"] as const) {
      const id = positiveInt((tmdb as Record<string, unknown>)[type]);
      if (!id) continue;
      const season = type === "tv" ? tmdbField(row.season) : null;
      out.push({
        anilistId,
        tmdbType: type,
        tmdbId: String(id),
        season: season !== null && season >= 0 ? season : null,
        offset: Math.max(0, tmdbField(row.episode_offset) ?? 0),
        malId: positiveInt(row.mal_id),
      });
    }
  }
  return out;
}

/** Downloads the file and replaces what's stored. Null when it couldn't be read; what's stored
 * stays as it was then. */
export async function refreshAnimeMap(): Promise<number | null> {
  let parsed: MapEntry[];
  try {
    const res = await fetch(env.animeMapUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok) return null;
    parsed = parseMapFile(await res.json());
  } catch {
    return null;
  }
  if (parsed.length === 0) return null;
  const seenAt = new Date();
  const col = await entries();
  const BULK = 2000;
  for (let i = 0; i < parsed.length; i += BULK) {
    await col.bulkWrite(
      parsed.slice(i, i + BULK).map((e) => {
        const _id = `${e.anilistId}:${e.tmdbType}:${e.tmdbId}`;
        return { replaceOne: { filter: { _id }, replacement: { ...e, _id, seenAt }, upsert: true } };
      }),
      { ordered: false },
    );
  }
  await col.deleteMany({ seenAt: { $ne: seenAt } });
  await (await meta()).replaceOne({ _id: META_ID }, { at: seenAt, count: parsed.length }, { upsert: true });
  return parsed.length;
}

/** When the stored copy was read; null before the first. */
export async function animeMapAt(): Promise<Date | null> {
  return (await (await meta()).findOne({ _id: META_ID }))?.at ?? null;
}

/** The AniList entries the file ties to a TMDb title. */
export async function mapEntriesFor(type: "movie" | "tv", tmdbId: string): Promise<MapEntry[]> {
  const docs = await (await entries()).find({ tmdbType: type, tmdbId }).toArray();
  return docs.map(({ _id, seenAt: _seenAt, ...entry }) => entry);
}

/** The TMDb titles the file ties these AniList entries to. */
export async function tmdbOfAnilist(ids: number[]): Promise<Map<number, string[]>> {
  const docs = await (await entries()).find({ anilistId: { $in: ids } }).toArray();
  const out = new Map<number, string[]>();
  for (const d of docs) out.set(d.anilistId, [...(out.get(d.anilistId) ?? []), `${d.tmdbType}:${d.tmdbId}`]);
  return out;
}

let refreshing: Promise<unknown> | null = null;

/** Reads the file at startup when it's missing or a week old, and checks twice a day after. */
export function startAnimeMapRefresh(): void {
  const tick = async () => {
    if (refreshing) return;
    const at = await animeMapAt().catch(() => null);
    if (at && Date.now() - at.getTime() < REFRESH_MS) return;
    refreshing = refreshAnimeMap()
      .then((count) => {
        if (count) console.log(`AniList map: ${count} titles`);
        else console.error("AniList map: the file couldn't be read; keeping the last copy");
      })
      .catch((error) => console.error("AniList map failed:", error))
      .finally(() => {
        refreshing = null;
      });
  };
  void tick();
  setInterval(() => void tick(), CHECK_EVERY_MS).unref();
}
