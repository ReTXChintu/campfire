import { env } from "../config/env";
import { getDb } from "./mongodb";

/**
 * AniList's GraphQL API (https://docs.anilist.co): free for an app like this one, no key needed to
 * read. It allows 90 requests a minute (30 while their service is degraded) and times a client out
 * for a minute past that, so requests go one at a time, paced by the limit headers, and every answer
 * is kept in Mongo. Their terms forbid mass collection: entries are only ever asked for when a title
 * is played or an admin opens it.
 */

/** One AniList entry: a season, a part of one, a film. */
export type AnilistMedia = {
  id: number;
  /** TV, TV_SHORT, ONA, OVA, SPECIAL, MOVIE, MUSIC. */
  format: string | null;
  /** FINISHED, RELEASING, NOT_YET_RELEASED, CANCELLED, HIATUS. */
  status: string | null;
  episodes: number | null;
  /** Episodes out so far: all of them once it's finished, else up to the next one to air. */
  aired: number | null;
  /** YYYY-MM-DD, or null when not known to the day. */
  startDate: string | null;
  title: { native: string | null; romaji: string | null; english: string | null };
  sequels: { id: number; format: string | null }[];
};

type RawMedia = {
  id: number;
  format?: string | null;
  status?: string | null;
  episodes?: number | null;
  nextAiringEpisode?: { episode?: number } | null;
  startDate?: { year?: number | null; month?: number | null; day?: number | null } | null;
  title?: { native?: string | null; romaji?: string | null; english?: string | null } | null;
  relations?: { edges?: { relationType?: string; node?: { id: number; type?: string; format?: string | null } }[] } | null;
};

type MediaDoc = AnilistMedia & { _id: number; fetchedAt: Date };

const FIELDS = `id format status episodes nextAiringEpisode { episode } startDate { year month day }
  title { native romaji english } relations { edges { relationType node { id type format } } }`;

const TIMEOUT_MS = 8000;
const FINISHED_TTL_MS = 30 * 24 * 60 * 60_000;
const AIRING_TTL_MS = 6 * 60 * 60_000;
const BATCH = 50;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const pad = (n: number) => String(n).padStart(2, "0");

function toMedia(raw: RawMedia): AnilistMedia {
  const d = raw.startDate;
  const startDate = d?.year && d.month && d.day ? `${d.year}-${pad(d.month)}-${pad(d.day)}` : null;
  const episodes = raw.episodes ?? null;
  const next = raw.nextAiringEpisode?.episode;
  const aired =
    raw.status === "NOT_YET_RELEASED" ? 0 : raw.status === "RELEASING" && next ? next - 1 : episodes;
  return {
    id: raw.id,
    format: raw.format ?? null,
    status: raw.status ?? null,
    episodes,
    aired,
    startDate,
    title: { native: raw.title?.native ?? null, romaji: raw.title?.romaji ?? null, english: raw.title?.english ?? null },
    sequels: (raw.relations?.edges ?? [])
      .filter((e) => e.relationType === "SEQUEL" && e.node?.type === "ANIME")
      .map((e) => ({ id: e.node!.id, format: e.node!.format ?? null })),
  };
}

// ---- Requests ---------------------------------------------------------------------------------------

let queue: Promise<unknown> = Promise.resolve();
/** Set by a 429 or an exhausted limit: nothing is sent before then. */
let pauseUntil = 0;

/** One request at a time, in the order asked. */
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

/** Null when AniList doesn't answer, refuses, or answers with errors. */
function query<T>(text: string, variables: Record<string, unknown>): Promise<T | null> {
  return serial(async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const wait = pauseUntil - Date.now();
      if (wait > 0) await sleep(wait);
      let res: Response;
      try {
        res = await fetch(env.anilistApiBase, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ query: text, variables }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        return null;
      }
      if (res.status === 429) {
        const retry = Number(res.headers.get("retry-after"));
        pauseUntil = Date.now() + (Number.isFinite(retry) && retry > 0 ? retry : 60) * 1000;
        continue;
      }
      // The last request the minute allows: wait for the next minute before another.
      const remaining = Number(res.headers.get("x-ratelimit-remaining"));
      if (res.headers.has("x-ratelimit-remaining") && Number.isFinite(remaining) && remaining <= 1) {
        const reset = Number(res.headers.get("x-ratelimit-reset"));
        pauseUntil = Number.isFinite(reset) && reset > 0 ? reset * 1000 : Date.now() + 60_000;
      }
      if (!res.ok) return null;
      try {
        const body = (await res.json()) as { data?: T | null; errors?: unknown[] };
        return body.errors?.length ? null : (body.data ?? null);
      } catch {
        return null;
      }
    }
    return null;
  });
}

/** AniList didn't answer, so "it has no such title" can't be told from "it's down". */
export class AnilistUnavailable extends Error {
  constructor() {
    super("AniList isn't answering");
  }
}

// ---- Entries ----------------------------------------------------------------------------------------

async function collection() {
  return (await getDb()).collection<MediaDoc>("anilistMedia");
}

const isFresh = (doc: MediaDoc) =>
  Date.now() - doc.fetchedAt.getTime() < (doc.status === "FINISHED" ? FINISHED_TTL_MS : AIRING_TTL_MS);

const strip = ({ _id, fetchedAt: _fetchedAt, ...media }: MediaDoc): AnilistMedia => media;

async function remember(list: AnilistMedia[]): Promise<void> {
  if (list.length === 0) return;
  const fetchedAt = new Date();
  await (await collection()).bulkWrite(
    list.map((m) => ({ replaceOne: { filter: { _id: m.id }, replacement: { ...m, _id: m.id, fetchedAt } as MediaDoc, upsert: true } })),
  );
}

/** Entries by their ids, from Mongo when known recently enough. An entry AniList doesn't answer for
 * keeps its last known copy, and one AniList says doesn't exist is missing from the result. Throws
 * AnilistUnavailable when AniList doesn't answer for an entry never seen before. */
export async function anilistMedia(ids: number[]): Promise<Map<number, AnilistMedia>> {
  const wanted = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  const found = new Map<number, AnilistMedia>();
  if (wanted.length === 0) return found;
  const docs = await (await collection()).find({ _id: { $in: wanted } }).toArray();
  const stale: number[] = [];
  for (const id of wanted) {
    const doc = docs.find((d) => d._id === id);
    if (doc) found.set(id, strip(doc));
    if (!doc || !isFresh(doc)) stale.push(id);
  }
  for (let i = 0; i < stale.length; i += BATCH) {
    const data = await query<{ Page?: { media?: RawMedia[] } }>(
      `query ($ids: [Int]) { Page(perPage: ${BATCH}) { media(id_in: $ids, type: ANIME) { ${FIELDS} } } }`,
      { ids: stale.slice(i, i + BATCH) },
    );
    if (!data) {
      if (stale.slice(i, i + BATCH).some((id) => !found.has(id))) throw new AnilistUnavailable();
      continue;
    }
    const fresh = (data.Page?.media ?? []).map(toMedia);
    for (const m of fresh) found.set(m.id, m);
    await remember(fresh);
  }
  return found;
}

/** AniList's own search, for a title the mapping file doesn't know. Null when AniList doesn't answer. */
export async function searchAnilist(text: string, formats: string[]): Promise<AnilistMedia[] | null> {
  if (!text.trim()) return [];
  const data = await query<{ Page?: { media?: RawMedia[] } }>(
    `query ($q: String, $f: [MediaFormat]) { Page(perPage: 10) { media(search: $q, type: ANIME, format_in: $f) { ${FIELDS} } } }`,
    { q: text, f: formats },
  );
  if (!data) return null;
  const list = (data.Page?.media ?? []).map(toMedia);
  await remember(list);
  return list;
}
