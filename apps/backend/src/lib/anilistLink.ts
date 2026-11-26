import { anilistMedia, AnilistUnavailable, searchAnilist, type AnilistMedia } from "./anilist";
import { animeMapAt, mapEntriesFor, tmdbOfAnilist } from "./animeMap";
import { rawDetail, tmdbCached } from "./explore";
import { getDb } from "./mongodb";
import type { TmdbRef } from "./tmdbRef";

/**
 * A TMDb title as AniList knows it, for anime players that take an AniList id
 * (`{{anilist_id}}`, lib/frameSource.ts). AniList makes every season — often every half of one — an
 * entry of its own, each numbering its episodes from 1, while TMDb may split a series differently or
 * lump it into one long season. So a series gets a table: which TMDb episodes are which AniList
 * entry, and the episode number there.
 *
 * The entries come from the mapping file (lib/animeMap.ts), else from AniList's search by the
 * Japanese title and first air date, plus the sequels AniList links them to. Each is laid over TMDb's
 * episodes in airing order, where the file says it starts, else straight after the one before, else
 * at the episode that aired the day it started — and kept only when the TMDb episode it starts at
 * aired within a few days of it. Specials (TMDb season 0) aren't matched. An admin can replace the
 * table, or turn a title off; that's never overwritten.
 */

/** TMDb episodes `from`–`to` of `season` are AniList entry `anilistId`, episode = TMDb's + `shift`. */
export type Segment = { season: number; from: number; to: number; anilistId: number; shift: number };

export type SeasonDates = { number: number; episodes: { number: number; airDate: string | null }[] };

export type ChainEntry = {
  id: number;
  /** Episodes out so far. */
  count: number;
  startDate: string | null;
  airing: boolean;
  /** Where the mapping file says it starts; season null means counted across the whole series. */
  anchor: { season: number | null; offset: number } | null;
  label: string;
};

const DAY_MS = 86_400_000;
const NEAR_DAYS = 3;

/** Whether two air dates are the same broadcast, give or take a few days: AniList dates a show by
 * Japan's broadcast, TMDb sometimes by a stream elsewhere. Null when either isn't known. */
export function sameAirDate(a: string | null | undefined, b: string | null | undefined): boolean | null {
  if (!a || !b) return null;
  const gap = Math.abs(Date.parse(a) - Date.parse(b));
  return Number.isFinite(gap) ? gap <= NEAR_DAYS * DAY_MS : null;
}

/** Lays the entries over TMDb's episodes (see the top of this file). Pure, for the smoke test. */
export function buildSegments(seasons: SeasonDates[], chain: ChainEntry[]): { segments: Segment[]; problems: string[] } {
  const positions = seasons
    .filter((s) => s.number >= 1)
    .sort((a, b) => a.number - b.number)
    .flatMap((s) =>
      [...s.episodes].sort((a, b) => a.number - b.number).map((e) => ({ season: s.number, episode: e.number, airDate: e.airDate })),
    );
  const problems: string[] = [];
  const indexOf = (season: number, episode: number) => positions.findIndex((p) => p.season === season && p.episode === episode);
  const seasonEnd = (i: number) => {
    let j = i;
    while (j + 1 < positions.length && positions[j + 1].season === positions[i].season) j++;
    return j + 1;
  };

  const ordered = [...chain].sort((a, b) => (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999") || a.id - b.id);
  const placed: { entry: ChainEntry; start: number }[] = [];
  let cursor = 0;
  for (const entry of ordered) {
    if (entry.count <= 0) continue; // not out yet
    const airsAt = (i: number) => (i >= 0 && i < positions.length ? sameAirDate(positions[i].airDate, entry.startDate) : false);
    let start = -1;
    if (entry.anchor) {
      const i = entry.anchor.season === null ? entry.anchor.offset : indexOf(entry.anchor.season, entry.anchor.offset + 1);
      if (airsAt(i) !== false) start = i;
    }
    if (start < 0 && cursor < positions.length) {
      // Straight after the one before, when it aired then — or, with no dates to go by, when that's
      // where a TMDb season starts.
      const fits = airsAt(cursor);
      if (fits === true || (fits === null && positions[cursor].episode === 1)) start = cursor;
    }
    if (start < 0 && entry.startDate) {
      start = positions.findIndex((p, i) => i >= cursor && sameAirDate(p.airDate, entry.startDate) === true);
    }
    if (start < 0) {
      problems.push(`${entry.label} doesn't line up with any TMDb episode`);
      continue;
    }
    placed.push({ entry, start });
    cursor = Math.max(cursor, start + entry.count);
  }

  placed.sort((a, b) => a.start - b.start);
  const segments: Segment[] = [];
  const covered = new Set<number>();
  placed.forEach(({ entry, start }, k) => {
    const next = placed[k + 1]?.start ?? positions.length;
    let end = Math.min(start + entry.count, next, positions.length);
    // Still airing: TMDb's episodes to come in its season are its too.
    if (entry.airing) end = Math.min(Math.max(end, seasonEnd(Math.min(start + entry.count, positions.length) - 1)), next);
    if (end <= start) {
      problems.push(`${entry.label} starts where another entry does`);
      return;
    }
    for (let i = start; i < end; i++) {
      const p = positions[i];
      const shift = i - start + 1 - p.episode;
      const last = segments.at(-1);
      if (last && last.anilistId === entry.id && last.season === p.season && last.shift === shift && last.to === p.episode - 1) {
        last.to = p.episode;
      } else {
        segments.push({ season: p.season, from: p.episode, to: p.episode, anilistId: entry.id, shift });
      }
      covered.add(i);
    }
  });

  // What's left over, by season: worth an admin's look.
  const gaps = new Map<number, number[]>();
  positions.forEach((p, i) => {
    if (!covered.has(i) && (p.airDate === null || p.airDate <= new Date().toISOString().slice(0, 10))) {
      gaps.set(p.season, [...(gaps.get(p.season) ?? []), p.episode]);
    }
  });
  for (const [season, episodes] of gaps) {
    problems.push(`Season ${season} episode${episodes.length === 1 ? "" : "s"} ${ranges(episodes)} ${episodes.length === 1 ? "has" : "have"} no AniList entry`);
  }
  return { segments, problems };
}

function ranges(numbers: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < numbers.length; i++) {
    let j = i;
    while (j + 1 < numbers.length && numbers[j + 1] === numbers[j] + 1) j++;
    out.push(i === j ? `${numbers[i]}` : `${numbers[i]}–${numbers[j]}`);
    i = j;
  }
  return out.join(", ");
}

/** The AniList entry and episode a TMDb episode is, by a table. */
export function episodeIn(segments: Segment[], season: number, episode: number): { id: number; episode: number } | null {
  const s = segments.find((seg) => seg.season === season && episode >= seg.from && episode <= seg.to);
  return s ? { id: s.anilistId, episode: episode + s.shift } : null;
}

// ---- Finding the entries ----------------------------------------------------------------------------

/** A series' own seasons on AniList; an OVA or special counts only where the file places it. */
const TV_FORMATS = ["TV", "TV_SHORT", "ONA"];
const PLACED_FORMATS = [...TV_FORMATS, "OVA", "SPECIAL"];
const MAX_ENTRIES = 60;
const MAX_ROUNDS = 4;
const SEASON_TTL_MS = 6 * 60 * 60_000;

type Detail = {
  name?: string;
  title?: string;
  original_name?: string;
  original_title?: string;
  first_air_date?: string;
  release_date?: string;
  seasons?: { season_number: number; episode_count?: number }[];
};

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");

const labelOf = (m: AnilistMedia) => `${m.title.english || m.title.romaji || m.title.native || "AniList"} (${m.id})`;

/** One entry AniList's search finds with the same title and start date; null when it's not exactly
 * one. Throws AnilistUnavailable when AniList doesn't answer. */
async function matchBySearch(names: string[], date: string | undefined, formats: string[], sameYearOk: boolean) {
  const wanted = new Set(names.map(norm).filter(Boolean));
  for (const name of names) {
    const results = await searchAnilist(name, formats);
    if (results === null) throw new AnilistUnavailable();
    const hits = results.filter((m) => {
      const titled = [m.title.native, m.title.romaji, m.title.english].some((t) => wanted.has(norm(t)));
      const dated =
        sameAirDate(m.startDate, date) === true ||
        (sameYearOk && !!date && !!m.startDate && m.startDate.slice(0, 4) === date.slice(0, 4));
      return titled && dated;
    });
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return null;
  }
  return null;
}

/** A series' entries and where the file places them. Null when AniList doesn't have it. */
async function seriesChain(tmdbId: string, detail: Detail) {
  const fromFile = await mapEntriesFor("tv", tmdbId);
  const specials = new Set(fromFile.filter((e) => e.season === 0).map((e) => e.anilistId));
  const mapped = fromFile.filter((e) => e.season !== 0);
  const anchors = new Map(mapped.map((e) => [e.anilistId, { season: e.season, offset: e.offset }]));
  let origin: "map" | "match" = "map";
  let media = await anilistMedia(mapped.map((e) => e.anilistId));
  if (media.size === 0) {
    const names = [detail.original_name, detail.name].filter((n): n is string => !!n?.trim());
    const first = await matchBySearch(names, detail.first_air_date, TV_FORMATS, false);
    if (!first) return null;
    media = new Map([[first.id, first]]);
    anchors.clear();
    origin = "match";
  }
  for (const [id, m] of media) {
    if (!(anchors.has(id) ? PLACED_FORMATS : TV_FORMATS).includes(m.format ?? "")) media.delete(id);
  }
  // The seasons AniList links on as sequels that the file doesn't list yet (a new season, or one it
  // missed). One the file gives to another TMDb title is that title's: Naruto → Naruto Shippuden.
  const asked = new Set(media.keys());
  for (let round = 0; round < MAX_ROUNDS && media.size < MAX_ENTRIES; round++) {
    const next = [...media.values()]
      .flatMap((m) => m.sequels)
      .filter((s) => TV_FORMATS.includes(s.format ?? "") && !asked.has(s.id) && !specials.has(s.id));
    if (next.length === 0) break;
    for (const s of next) asked.add(s.id);
    const owners = await tmdbOfAnilist(next.map((s) => s.id));
    const ours = next.filter((s) => (owners.get(s.id) ?? [`tv:${tmdbId}`]).includes(`tv:${tmdbId}`)).map((s) => s.id);
    const found = await anilistMedia(ours.slice(0, MAX_ENTRIES - media.size));
    for (const m of found.values()) if (TV_FORMATS.includes(m.format ?? "")) media.set(m.id, m);
  }
  return { origin, media, anchors };
}

/** A film's entry. Null when AniList doesn't have it. */
async function filmEntry(tmdbId: string, detail: Detail): Promise<{ origin: "map" | "match"; id: number } | null> {
  const mapped = await mapEntriesFor("movie", tmdbId);
  if (mapped.length > 0) {
    const media = await anilistMedia(mapped.map((e) => e.anilistId));
    const film = [...media.values()].find((m) => m.format === "MOVIE") ?? [...media.values()][0];
    if (film) return { origin: "map", id: film.id };
  }
  const names = [detail.original_title, detail.title].filter((n): n is string => !!n?.trim());
  const found = await matchBySearch(names, detail.release_date, ["MOVIE"], true);
  return found ? { origin: "match", id: found.id } : null;
}

/** Each TMDb season's episodes with their air dates; null when TMDb isn't answering. */
async function seasonDates(tmdbId: string, detail: Detail): Promise<SeasonDates[] | null> {
  const numbers = (detail.seasons ?? []).filter((s) => s.season_number >= 1 && (s.episode_count ?? 0) > 0).map((s) => s.season_number);
  // The same cached answers as the episode list's (lib/titlePlay.ts).
  const lists = await Promise.all(
    numbers.map((n) =>
      tmdbCached<{ episodes?: { episode_number: number; air_date?: string | null }[] }>(
        `/tv/${tmdbId}/season/${n}`,
        { language: "en-US" },
        SEASON_TTL_MS,
      ),
    ),
  );
  if (lists.some((l) => l === null)) return null;
  return numbers.map((number, i) => ({
    number,
    episodes: (lists[i]!.episodes ?? []).map((e) => ({ number: e.episode_number, airDate: e.air_date || null })),
  }));
}

// ---- Stored tables ----------------------------------------------------------------------------------

export type AdminLink = { off: boolean; segments: Segment[] | null; movie: number | null };

type LinkDoc = {
  _id: string; // "tv:85937", "movie:372058"
  type: "movie" | "tv";
  tmdbId: string;
  title: string;
  /** Where the entries came from; "none" when AniList doesn't have the title. */
  origin: "map" | "match" | "none";
  segments: Segment[];
  movie: number | null;
  entries: number[];
  problems: string[];
  airing: boolean;
  builtAt: Date;
  mapAt: Date | null;
  admin: AdminLink | null;
};

const REBUILD_MS = 7 * 24 * 60 * 60_000;
const AIRING_REBUILD_MS = 12 * 60 * 60_000;

async function links() {
  return (await getDb()).collection<LinkDoc>("anilistLinks");
}

/** A fresh table, or null when TMDb or AniList isn't answering (nothing is stored then). */
async function build(type: "movie" | "tv", tmdbId: string): Promise<Omit<LinkDoc, "admin"> | null> {
  const detail = (await rawDetail(type, tmdbId)) as Detail | null;
  if (!detail) return null;
  const base = {
    _id: `${type}:${tmdbId}`,
    type,
    tmdbId,
    title: (type === "movie" ? detail.title : detail.name) || tmdbId,
    builtAt: new Date(),
    mapAt: await animeMapAt(),
  };
  try {
    if (type === "movie") {
      const film = await filmEntry(tmdbId, detail);
      return {
        ...base,
        origin: film?.origin ?? "none",
        segments: [],
        movie: film?.id ?? null,
        entries: film ? [film.id] : [],
        problems: film ? [] : ["AniList has no such film"],
        airing: false,
      };
    }
    const chain = await seriesChain(tmdbId, detail);
    if (!chain) {
      return { ...base, origin: "none", segments: [], movie: null, entries: [], problems: ["AniList has no such series"], airing: false };
    }
    const seasons = await seasonDates(tmdbId, detail);
    if (!seasons) return null;
    const entries: ChainEntry[] = [...chain.media.values()].map((m) => ({
      id: m.id,
      count: m.aired ?? m.episodes ?? 0,
      startDate: m.startDate,
      airing: m.status === "RELEASING",
      anchor: chain.anchors.get(m.id) ?? null,
      label: labelOf(m),
    }));
    const { segments, problems } = buildSegments(seasons, entries);
    return {
      ...base,
      origin: chain.origin,
      segments,
      movie: null,
      entries: entries.map((e) => e.id),
      problems,
      airing: entries.some((e) => e.airing),
    };
  } catch (error) {
    if (error instanceof AnilistUnavailable) return null;
    throw error;
  }
}

const building = new Map<string, Promise<LinkDoc | null>>();

function rebuild(type: "movie" | "tv", tmdbId: string): Promise<LinkDoc | null> {
  const key = `${type}:${tmdbId}`;
  const running = building.get(key);
  if (running) return running;
  const task = (async () => {
    const fresh = await build(type, tmdbId);
    if (!fresh) return null;
    const col = await links();
    await col.updateOne({ _id: fresh._id }, { $set: fresh, $setOnInsert: { admin: null } }, { upsert: true });
    return col.findOne({ _id: fresh._id });
  })()
    .catch((error) => {
      console.error(`[anilist] ${key}:`, error);
      return null;
    })
    .finally(() => building.delete(key));
  building.set(key, task);
  return task;
}

async function isStale(doc: LinkDoc): Promise<boolean> {
  if (Date.now() - doc.builtAt.getTime() > (doc.airing ? AIRING_REBUILD_MS : REBUILD_MS)) return true;
  const mapAt = await animeMapAt();
  return !!mapAt && (!doc.mapAt || doc.mapAt < mapAt);
}

/** A title's stored table, made or remade when it's due. An outdated one is answered while the
 * new one is made; with none at all this waits at most `waitMs` for it. */
async function linkOf(type: "movie" | "tv", tmdbId: string, waitMs: number): Promise<LinkDoc | null> {
  const doc = await (await links()).findOne({ _id: `${type}:${tmdbId}` });
  if (doc && !(await isStale(doc))) return doc;
  const pending = rebuild(type, tmdbId);
  if (doc) return doc;
  return Promise.race([pending, new Promise<null>((resolve) => setTimeout(() => resolve(null), waitMs).unref())]);
}

/** The AniList entry and episode a film or episode is; null when that isn't known for certain. A
 * film is its entry's episode 1. */
export async function anilistFor(ref: TmdbRef, waitMs = 4000): Promise<{ id: number; episode: number } | null> {
  if (ref.type === "tv" && (!ref.season || ref.season < 1 || ref.episode == null)) return null;
  const link = await linkOf(ref.type, ref.id, waitMs);
  if (!link || link.admin?.off) return null;
  if (ref.type === "movie") {
    const id = link.admin?.movie ?? link.movie;
    return id ? { id, episode: 1 } : null;
  }
  return episodeIn(link.admin?.segments ?? link.segments, ref.season!, ref.episode!);
}

// ---- Admin -------------------------------------------------------------------------------------------

/** Every title looked at, newest first. */
export async function listLinks(limit = 200) {
  const docs = await (await links()).find({}).sort({ builtAt: -1 }).limit(limit).toArray();
  return docs.map((d) => ({
    type: d.type,
    tmdbId: d.tmdbId,
    title: d.title,
    origin: d.origin,
    problems: d.problems.length,
    admin: d.admin ? (d.admin.off ? "off" : "set") : null,
    builtAt: d.builtAt,
  }));
}

/** One title's table with the entries it names, made first if it has to be. Null when TMDb or
 * AniList isn't answering and nothing is stored. */
export async function linkDetails(type: "movie" | "tv", tmdbId: string, { fresh = false } = {}) {
  const doc = fresh ? ((await rebuild(type, tmdbId)) ?? (await (await links()).findOne({ _id: `${type}:${tmdbId}` }))) : await linkOf(type, tmdbId, 20_000);
  if (!doc) return null;
  const ids = [...new Set([...doc.entries, ...(doc.admin?.segments ?? []).map((s) => s.anilistId), ...(doc.admin?.movie ? [doc.admin.movie] : [])])];
  const media = await anilistMedia(ids).catch(() => new Map<number, AnilistMedia>());
  return {
    type: doc.type,
    tmdbId: doc.tmdbId,
    title: doc.title,
    origin: doc.origin,
    segments: doc.segments,
    movie: doc.movie,
    problems: doc.problems,
    builtAt: doc.builtAt,
    admin: doc.admin,
    entries: ids.map((id) => {
      const m = media.get(id);
      return {
        id,
        title: m ? (m.title.english || m.title.romaji || m.title.native) : null,
        format: m?.format ?? null,
        episodes: m?.episodes ?? null,
        startDate: m?.startDate ?? null,
        status: m?.status ?? null,
      };
    }),
  };
}

const int = (v: unknown, min: number, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);

/** An admin's table as sent, or what's wrong with it. AniList ids are checked to exist. */
export async function parseAdminLink(type: "movie" | "tv", body: unknown): Promise<AdminLink | string> {
  const input = (body ?? {}) as { off?: unknown; segments?: unknown; movie?: unknown };
  if (input.off === true) return { off: true, segments: null, movie: null };
  if (type === "movie") {
    const movie = int(input.movie, 1, 10_000_000);
    if (!movie) return "Give the film's AniList id.";
    const found = await anilistMedia([movie]).catch(() => null);
    if (!found) return "AniList isn't answering — try again in a minute.";
    if (!found.has(movie)) return `AniList has no anime ${movie}.`;
    return { off: false, segments: null, movie };
  }
  if (!Array.isArray(input.segments) || input.segments.length === 0 || input.segments.length > 300) {
    return "Give at least one row.";
  }
  const segments: Segment[] = [];
  for (const [i, raw] of (input.segments as Record<string, unknown>[]).entries()) {
    const season = int(raw?.season, 1, 999);
    const from = int(raw?.from, 1, 99_999);
    const to = int(raw?.to, 1, 99_999);
    const anilistId = int(raw?.anilistId, 1, 10_000_000);
    const shift = int(raw?.shift, -99_999, 99_999);
    if (season === null || from === null || to === null || anilistId === null || shift === null || to < from) {
      return `Row ${i + 1} isn't complete: season, episodes from–to, AniList id and the episode shift are all needed.`;
    }
    if (from + shift < 1) return `Row ${i + 1} would start at AniList episode ${from + shift}.`;
    segments.push({ season, from, to, anilistId, shift });
  }
  for (const a of segments) {
    if (segments.some((b) => b !== a && b.season === a.season && b.from <= a.to && a.from <= b.to)) {
      return `Season ${a.season} has rows that overlap.`;
    }
  }
  const ids = [...new Set(segments.map((s) => s.anilistId))];
  const found = await anilistMedia(ids).catch(() => null);
  if (!found) return "AniList isn't answering — try again in a minute.";
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) return `AniList has no anime ${missing.join(", ")}.`;
  return { off: false, segments: segments.sort((a, b) => a.season - b.season || a.from - b.from), movie: null };
}

/** Sets an admin's table (null goes back to the automatic one). False when the title has never been
 * looked at and can't be now. */
export async function setAdminLink(type: "movie" | "tv", tmdbId: string, admin: AdminLink | null): Promise<boolean> {
  const col = await links();
  let doc = await col.findOne({ _id: `${type}:${tmdbId}` });
  if (!doc) doc = await rebuild(type, tmdbId);
  if (!doc) return false;
  await col.updateOne({ _id: doc._id }, { $set: { admin } });
  return true;
}
