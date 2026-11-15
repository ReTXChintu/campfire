import { createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { env } from "../config/env";
import { getDb } from "./mongodb";
import { parseReferenceLink, tmdbFetch } from "./referenceLink";

/** Artwork for catalog titles: a top-level movie (a video in the library root) or series (a folder
 * in the root) is matched to a TMDb title, and that title's backdrop becomes its card and hero
 * image. A match comes from one of two places:
 *
 *  - a link an admin pasted (IMDb or TMDb) — explicit, always wins; or
 *  - an automatic search on the title (and the year in the Drive filename), accepted only when the
 *    name matches exactly, so a wrong picture is far less likely than no picture.
 *
 * Only the TMDb ids and image paths are stored (on the catalog doc itself). The image bytes are
 * fetched from TMDb the first time somebody views them and kept on this server's disk — not in
 * Drive: the service account owns anything it writes and has no storage quota of its own on a
 * personal Drive (see the note at the top of lib/drive.ts), so a Drive upload would fail. Clients
 * never talk to TMDb; they keep loading /api/thumbnail/... exactly as before, which is also why an
 * already-installed app shows artwork without an update. */

export type ArtworkKind = "folder" | "video";

/** One billed cast member, in TMDb's own billing order. */
export type CatalogCastMember = {
  name: string;
  character: string | null;
  profilePath: string | null; // TMDb image path for the headshot
};

export type CatalogArtwork = {
  source: "link" | "auto";
  tmdbType: "movie" | "tv";
  tmdbId: string;
  title: string;
  year: number | null;
  overview: string | null;
  backdropPath: string | null; // TMDb image path, e.g. "/abc123.jpg"
  posterPath: string | null;
  matchedAt: Date;

  // Everything below came later, so it's all optional: a title matched by an older build has a
  // doc without these fields, and re-matching it (or the next scan's auto-match top-up) fills
  // them in. Readers must treat absent and null the same way.
  /** The marketing one-liner ("Every hero has a beginning"), not the synopsis. */
  tagline?: string | null;
  /** A film's length, or a series' typical episode length. */
  runtimeMinutes?: number | null;
  /** At most three, in TMDb's order — enough for a facts line, not a tag cloud. */
  genres?: string[];
  /** Age rating as the local board writes it ("U/A 16+", "PG-13"), preferring India then the US. */
  certificate?: string | null;
  /** TMDb's own user score. Not IMDb's — TMDb doesn't publish those. */
  rating?: { average: number; count: number } | null;
  /** The title's wordmark on transparency, for the spotlight. */
  logoPath?: string | null;
  /** Series only. */
  seasonCount?: number | null;
  episodeCount?: number | null;
  cast?: CatalogCastMember[];
};

/** The artwork fields both catalog collections carry. All optional — docs written before this
 * feature simply don't have them. */
export type ArtworkFields = {
  artwork?: CatalogArtwork | null;
  /** An admin removed the artwork: don't auto-match this title again until they ask. */
  artworkAutoOff?: boolean;
  /** The search last tried automatically without a match, so a scan doesn't repeat it every time.
   * A changed title produces a different key, so it is searched again. */
  artworkTriedFor?: string | null;
  /** Folders only: which season of the matched series this folder holds. A series whose episodes
   * sit directly in it is season 1; a "Season 2"/"S02" subfolder is 2. Guessed from the name and
   * overridable in admin — see lib/episodeArtwork.ts. */
  tmdbSeason?: number | null;
  /** Folders only: an admin turned off naming this series' episodes from TMDb. */
  episodeArtworkOff?: boolean;
  /** Videos only: this video's episode on TMDb (name, synopsis, still). Set by the episode match,
   * which needs the series' own `artwork` on an ancestor folder. */
  episodeArtwork?: CatalogEpisodeArtwork | null;
};

/** One episode's TMDb data, matched by position within its season (see lib/episodeArtwork.ts).
 * Separate from `artwork`, which means "this video is a film in its own right". */
export type CatalogEpisodeArtwork = {
  seriesTmdbId: string;
  season: number;
  episode: number;
  name: string | null;
  overview: string | null;
  stillPath: string | null; // 16:9 frame from the episode itself
  airDate: string | null; // ISO date, as TMDb gives it
  runtimeMinutes: number | null;
  rating: { average: number; count: number } | null;
  matchedAt: Date;
};

type ArtworkDoc = {
  _id: string;
  parentFolderId: string;
  driveName: string;
  title: string | null;
  /** Videos only (see CatalogVideo): an admin typed this title, so nothing rewrites it. */
  titleOverridden?: boolean;
} & ArtworkFields;

async function collection(kind: ArtworkKind) {
  const db = await getDb();
  return db.collection<ArtworkDoc>(kind === "folder" ? "catalogFolders" : "catalogVideos");
}

// --- Names --------------------------------------------------------------------------------------

const VIDEO_EXT_RE = /\.(mkv|mp4|m4v|avi|mov|webm|ts|wmv|flv|mpg|mpeg)$/i;
// Where a release name with no year stops being the title: resolution, source, codec, language
// and episode tags. Only unambiguous ones — "Charlotte's Web", "Johnny English" and "The Complete
// Works" are titles, so plain words like web/english/complete aren't on it.
const RELEASE_JUNK_RE =
  /\b(2160p|1080p|720p|576p|480p|4k|uhd|web[- ]?dl|web[- ]?rip|webrip|blu[- ]?ray|brrip|bdrip|hdrip|dvdrip|dvdscr|hdtv|hdcam|hdtc|hqcam|camrip|x26[45]|h ?26[45]|hevc|aac\d?|ac3|ddp?\d(?: ?\d)?|10 ?bit|hdr\d*|repack|dual[- ]audio|hindi|tamil|telugu|esubs?|hd|bollywood|hollywood|tollywood|s\d{1,2}(?:e\d{1,3})?|season \d+)\b/i;

/** Pulls a searchable title and a year out of a Drive filename or a curated title:
 * "Weapons.2025.1080p.WEB-DL.mkv" → { "Weapons", 2025 }, "The Shawshank Redemption (1994)" →
 * { "The Shawshank Redemption", 1994 }, "[YTS] 1917 (2019) [1080p]" → { "1917", 2019 }. */
export function parseReleaseName(raw: string): { query: string; year: number | null } {
  let s = raw.replace(VIDEO_EXT_RE, "");
  // Leading site/release-group tags: "[YTS] …", "(FilmyFly.CA) …", "www.site.com - …". A leading
  // parenthesis without a dot stays — "(500) Days of Summer" is a title.
  s = s.replace(/^\s*(?:www\.\S+\s*[-–]\s*|\[[^\]]*\]\s*|\([^)]*\.[^)]*\)\s*)+/i, "");
  s = s.replace(/[._]+/g, " ");

  let year: number | null = null;
  let cut = s.length;
  // The last plausible year that isn't the very start of the name ("1917 2019" is the film 1917).
  const years = [...s.matchAll(/(?:^|[\s([{-])((?:19|20)\d{2})(?=$|[\s)\]}-])/g)].filter((m) => (m.index ?? 0) > 0);
  const last = years[years.length - 1];
  if (last) {
    const value = Number(last[1]);
    if (value >= 1900 && value <= new Date().getFullYear() + 2) {
      year = value;
      cut = last.index!;
    }
  }
  // With a year, the title is what comes before it (release names are Title.Year.tags…).
  if (year == null) {
    const junk = s.search(RELEASE_JUNK_RE);
    if (junk > 0) cut = junk;
  }

  // Bracketed asides go ("{Hindi-English}", "[1080p]"); a leading one is part of the title.
  const head = s.slice(0, cut).replace(/^\s*\(([^)]*)\)/, "$1");
  const query = head
    .replace(/[[({][^\])}]*[\])}]/g, " ")
    .replace(/[[\](){}]/g, " ")
    .replace(/\s+[-–:]+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return { query: query || s.trim(), year };
}

/** Comparable form of a title: case, accents, punctuation and a leading article don't count. */
export function normaliseTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^(the|a|an) /, "")
    .replace(/ /g, "");
}

// --- TMDb ---------------------------------------------------------------------------------------

export type TmdbResult = {
  id: number;
  title?: string;
  original_title?: string;
  name?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string | null;
  backdrop_path?: string | null;
  poster_path?: string | null;
  popularity?: number;
};

function yearOf(r: TmdbResult): number | null {
  const date = r.release_date || r.first_air_date || "";
  return /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null;
}

/** An image from a `/images` block. `iso_639_1` is the language of the text burnt into it, and
 * null means there is none — which is what a hero wants, since it draws the title itself. */
type TmdbImage = { file_path?: string | null; iso_639_1?: string | null; vote_average?: number };

/** A `/movie/{id}` or `/tv/{id}` response with everything we append to it in one round trip. */
type TmdbDetail = TmdbResult & {
  tagline?: string | null;
  runtime?: number | null; // movie
  episode_run_time?: number[]; // tv
  genres?: { name?: string }[];
  vote_average?: number;
  vote_count?: number;
  number_of_seasons?: number | null;
  number_of_episodes?: number | null;
  images?: { backdrops?: TmdbImage[]; posters?: TmdbImage[]; logos?: TmdbImage[] };
  credits?: { cast?: TmdbCastEntry[] };
  aggregate_credits?: { cast?: TmdbCastEntry[] };
  release_dates?: { results?: { iso_3166_1?: string; release_dates?: { certification?: string }[] }[] };
  content_ratings?: { results?: { iso_3166_1?: string; rating?: string }[] };
};

type TmdbCastEntry = {
  name?: string;
  character?: string | null;
  roles?: { character?: string | null }[]; // tv aggregate_credits says it this way
  profile_path?: string | null;
  order?: number;
};

const MAX_CAST = 12;
const MAX_GENRES = 3;
// Whose age rating to show, most relevant first — this is an India-based library.
const CERTIFICATE_COUNTRIES = ["IN", "US", "GB"];

/** The best image of a kind. `textless` prefers one with no burnt-in words (for backdrops the
 * hero writes over); otherwise English text is preferred over none, then anything. Within a
 * group TMDb's own vote decides, which is what its site shows first. */
function pickImage(images: TmdbImage[] | undefined, opts: { textless?: boolean } = {}): string | null {
  const usable = (images ?? []).filter((i) => i.file_path && TMDB_PATH_RE.test(i.file_path));
  if (usable.length === 0) return null;
  const rank = (i: TmdbImage): number => {
    const lang = i.iso_639_1 ?? null;
    if (opts.textless) return lang === null ? 0 : lang === "en" ? 1 : 2;
    return lang === "en" ? 0 : lang === null ? 1 : 2;
  };
  const best = [...usable].sort((a, b) => rank(a) - rank(b) || (b.vote_average ?? 0) - (a.vote_average ?? 0))[0];
  return best.file_path!;
}

/** A logo has to be a PNG: TMDb also serves SVG wordmarks, and those can't go through the
 * fixed-size image CDN paths the rest of this module caches. */
function pickLogo(logos: TmdbImage[] | undefined): string | null {
  const png = (logos ?? []).filter((l) => l.file_path?.toLowerCase().endsWith(".png"));
  return pickImage(png);
}

function certificateOf(detail: TmdbDetail): string | null {
  for (const country of CERTIFICATE_COUNTRIES) {
    const movie = detail.release_dates?.results?.find((r) => r.iso_3166_1 === country);
    const fromMovie = movie?.release_dates?.map((r) => r.certification?.trim()).find((c) => c);
    if (fromMovie) return fromMovie;
    const tv = detail.content_ratings?.results?.find((r) => r.iso_3166_1 === country);
    if (tv?.rating?.trim()) return tv.rating.trim();
  }
  return null;
}

function castOf(detail: TmdbDetail): CatalogCastMember[] {
  const entries = detail.aggregate_credits?.cast ?? detail.credits?.cast ?? [];
  return [...entries]
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    .slice(0, MAX_CAST)
    .map((c) => ({
      name: c.name?.trim() || "",
      character: (c.character ?? c.roles?.[0]?.character)?.trim() || null,
      profilePath: c.profile_path && TMDB_PATH_RE.test(c.profile_path) ? c.profile_path : null,
    }))
    .filter((c) => c.name);
}

function toArtwork(r: TmdbDetail, tmdbType: "movie" | "tv", source: CatalogArtwork["source"]): CatalogArtwork {
  const runtime = tmdbType === "movie" ? r.runtime : r.episode_run_time?.[0];
  const voteCount = r.vote_count ?? 0;
  return {
    source,
    tmdbType,
    tmdbId: String(r.id),
    title: r.title || r.name || "",
    year: yearOf(r),
    overview: r.overview?.trim() || null,
    // A hand-picked textless backdrop beats TMDb's default, which often has the title burnt in —
    // the spotlight draws its own title over it. Falls back to the default when there's no
    // `images` block (an older cached response, or a title with none).
    backdropPath: pickImage(r.images?.backdrops, { textless: true }) ?? r.backdrop_path ?? null,
    posterPath: pickImage(r.images?.posters) ?? r.poster_path ?? null,
    matchedAt: new Date(),
    tagline: r.tagline?.trim() || null,
    runtimeMinutes: typeof runtime === "number" && runtime > 0 ? runtime : null,
    genres: (r.genres ?? []).map((g) => g.name?.trim()).filter((n): n is string => !!n).slice(0, MAX_GENRES),
    certificate: certificateOf(r),
    // A score with nobody behind it is noise, not information.
    rating: typeof r.vote_average === "number" && r.vote_average > 0 && voteCount > 0
      ? { average: Math.round(r.vote_average * 10) / 10, count: voteCount }
      : null,
    logoPath: pickLogo(r.images?.logos),
    seasonCount: tmdbType === "tv" ? (r.number_of_seasons ?? null) : null,
    episodeCount: tmdbType === "tv" ? (r.number_of_episodes ?? null) : null,
    cast: castOf(r),
  };
}

/** The full record for a title. A search result alone carries only a name, year and two images,
 * so every match ends with this one extra call — `append_to_response` keeps it to one request,
 * and `include_image_language` limits the image lists to ones we would actually choose. */
async function fetchDetail(type: "movie" | "tv", id: string | number): Promise<TmdbDetail | null> {
  return tmdbFetch<TmdbDetail>(`/${type}/${id}`, {
    append_to_response: type === "movie" ? "images,credits,release_dates" : "images,aggregate_credits,content_ratings",
    include_image_language: "en,null",
  });
}

/** Search result → artwork, by way of the detail call. Falls back to the search result alone if
 * the detail call fails, so a TMDb hiccup still leaves a matched title with its images. */
async function detailedArtwork(
  r: TmdbResult,
  type: "movie" | "tv",
  source: CatalogArtwork["source"],
): Promise<CatalogArtwork> {
  const detail = await fetchDetail(type, r.id);
  return toArtwork(detail ? { ...r, ...detail } : r, type, source);
}

/** The confident pick from a search, or null. A name has to match exactly (after normalising);
 * with a year known, the release year has to agree within one (festival vs. general release), so
 * a remake with the same name from another year is rejected rather than guessed at. */
export function pickMatch(results: TmdbResult[], query: string, year: number | null): TmdbResult | null {
  const q = normaliseTitle(query);
  if (!q) return null;
  const named = results.filter((r) =>
    [r.title, r.original_title, r.name, r.original_name].some((n) => n && normaliseTitle(n) === q),
  );
  if (year != null) {
    const exactYear = named.find((r) => yearOf(r) === year);
    if (exactYear) return exactYear;
    const nearYear = named.find((r) => {
      const y = yearOf(r);
      return y != null && Math.abs(y - year) <= 1;
    });
    return nearYear ?? null;
  }
  // No year to tell versions apart: take it only when the name is unambiguous, or one version is
  // clearly the one people mean.
  if (named.length === 1) return named[0];
  if (named.length > 1) {
    const [first, second] = [...named].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
    if ((first.popularity ?? 0) >= 3 * (second.popularity ?? 0)) return first;
  }
  return null;
}

async function search(kind: ArtworkKind, query: string, year: number | null): Promise<CatalogArtwork | null> {
  // A root folder is normally a series and a root video a film, but a folder can also be one film
  // uploaded with its extras — a folder that finds no series tries films too.
  const types: ("movie" | "tv")[] = kind === "folder" ? ["tv", "movie"] : ["movie"];
  for (const type of types) {
    const found = await tmdbFetch<{ results: TmdbResult[] }>(`/search/${type}`, {
      query,
      include_adult: "false",
    });
    const match = found ? pickMatch(found.results ?? [], query, year) : null;
    if (match) return detailedArtwork(match, type, "auto");
  }
  return null;
}

/** Resolves a pasted IMDb or TMDb link to artwork, or null when TMDb doesn't know it. */
async function fromLink(link: string): Promise<CatalogArtwork | null> {
  const parsed = parseReferenceLink(link);
  if (!parsed) return null;
  if (parsed.source === "tmdb") {
    const type = parsed.type === "series" ? "tv" : "movie";
    const raw = await fetchDetail(type, parsed.id);
    return raw ? toArtwork(raw, type, "link") : null;
  }
  const found = await tmdbFetch<{ movie_results: TmdbResult[]; tv_results: TmdbResult[] }>(`/find/${parsed.id}`, {
    external_source: "imdb_id",
  });
  const movie = found?.movie_results?.[0];
  if (movie) return detailedArtwork(movie, "movie", "link");
  const tv = found?.tv_results?.[0];
  if (tv) return detailedArtwork(tv, "tv", "link");
  return null;
}

// --- Matching -----------------------------------------------------------------------------------

function searchFor(doc: ArtworkDoc): { query: string; year: number | null; key: string } {
  // The curated title is the better query (an admin cleaned it up); the Drive name is where the
  // year usually is.
  const fromTitle = doc.title ? parseReleaseName(doc.title) : null;
  const fromDrive = parseReleaseName(doc.driveName);
  const query = fromTitle?.query || fromDrive.query;
  const year = fromTitle?.year ?? fromDrive.year;
  return { query, year, key: `${query}|${year ?? ""}` };
}

export type ArtworkErrorCode = "no-key" | "bad-link" | "not-found" | "missing";

export class ArtworkLookupError extends Error {
  constructor(
    readonly code: ArtworkErrorCode,
    message: string,
  ) {
    super(message);
  }
}

async function getDoc(kind: ArtworkKind, id: string): Promise<ArtworkDoc> {
  const doc = await (await collection(kind)).findOne({ _id: id });
  if (!doc) throw new ArtworkLookupError("missing", "Not found");
  return doc;
}

async function save(
  kind: ArtworkKind,
  id: string,
  set: Partial<ArtworkFields> & { title?: string },
): Promise<void> {
  await (await collection(kind)).updateOne({ _id: id }, { $set: set });
}

/** The `{ title }` to write alongside a new match, or nothing. Skipped when an admin typed the
 * title themselves (videos carry that flag) and whenever the names aren't the same title — see
 * cleanedTitle. */
function titleUpdate(doc: ArtworkDoc, artwork: CatalogArtwork): { title?: string } {
  if (doc.titleOverridden) return {};
  const title = cleanedTitle(doc.title, artwork);
  return title ? { title } : {};
}

/** Admin pasted a link: resolve it and make it this title's artwork. */
export async function setArtworkFromLink(kind: ArtworkKind, id: string, link: string): Promise<CatalogArtwork> {
  const doc = await getDoc(kind, id);
  if (!env.tmdbApiKey) throw new ArtworkLookupError("no-key", "TMDB_API_KEY isn't set on the server");
  if (!parseReferenceLink(link)) {
    throw new ArtworkLookupError("bad-link", "Paste an IMDb link (imdb.com/title/tt…) or a TMDb movie or TV link");
  }
  const artwork = await fromLink(link);
  if (!artwork) throw new ArtworkLookupError("not-found", "TMDb doesn't have that title");
  await save(kind, id, { artwork, artworkAutoOff: false, ...titleUpdate(doc, artwork) });
  warmImage(artwork);
  return artwork;
}

/** Admin asked for an automatic match on this one title now, ignoring an earlier miss. */
export async function matchArtworkNow(kind: ArtworkKind, id: string): Promise<CatalogArtwork> {
  const doc = await getDoc(kind, id);
  if (!env.tmdbApiKey) throw new ArtworkLookupError("no-key", "TMDB_API_KEY isn't set on the server");
  const { query, year, key } = searchFor(doc);
  const artwork = await search(kind, query, year);
  if (!artwork) {
    await save(kind, id, { artworkTriedFor: key });
    throw new ArtworkLookupError(
      "not-found",
      `No confident match for "${query}"${year ? ` (${year})` : ""}. Paste its IMDb or TMDb link instead.`,
    );
  }
  await save(kind, id, { artwork, artworkAutoOff: false, artworkTriedFor: key, ...titleUpdate(doc, artwork) });
  warmImage(artwork);
  return artwork;
}

/** Admin removed the artwork: back to the Drive image, and no automatic match until asked. */
export async function clearArtwork(kind: ArtworkKind, id: string): Promise<void> {
  await getDoc(kind, id);
  await save(kind, id, { artwork: null, artworkAutoOff: true });
}

export type AutoMatchResult = {
  skipped?: "no-key";
  matched: { kind: ArtworkKind; id: string; name: string; tmdbTitle: string; year: number | null }[];
  unmatched: { kind: ArtworkKind; id: string; name: string; query: string; year: number | null }[];
  /** Titles whose own name was replaced with TMDb's, as "<before>" → "<after>". */
  renamed: { kind: ArtworkKind; id: string; from: string; to: string }[];
  /** Already-matched titles topped up with the metadata a newer build knows how to fetch. */
  enriched: number;
};

let running: Promise<AutoMatchResult> | null = null;

/** Matches every top-level movie and series that has no artwork yet. Safe to call often (after a
 * scan, at startup): a title that already missed under the same name isn't searched again unless
 * `retry` is set, and overlapping calls share one run. */
export function autoMatchArtwork(options: { retry?: boolean } = {}): Promise<AutoMatchResult> {
  if (!running) running = runAutoMatch(options.retry ?? false).finally(() => (running = null));
  return running;
}

async function runAutoMatch(retry: boolean): Promise<AutoMatchResult> {
  const result: AutoMatchResult = { matched: [], unmatched: [], renamed: [], enriched: 0 };
  if (!env.tmdbApiKey) return { ...result, skipped: "no-key" };

  for (const kind of ["folder", "video"] as const) {
    const col = await collection(kind);

    // Pass 1: titles matched by an earlier build, before there was anything to store beyond two
    // image paths. `artwork.cast` is the marker — set on every match this build makes, even when
    // the list comes back empty. Re-fetching is one call each and happens once.
    const stale = await col
      .find({ artwork: { $ne: null }, "artwork.cast": { $exists: false } })
      .toArray();
    for (const doc of stale) {
      const old = doc.artwork!;
      const detail = await fetchDetail(old.tmdbType, old.tmdbId);
      if (!detail) continue;
      const artwork = { ...toArtwork(detail, old.tmdbType, old.source), matchedAt: old.matchedAt };
      const rename = titleUpdate(doc, artwork);
      await col.updateOne({ _id: doc._id }, { $set: { artwork, ...rename } });
      warmImage(artwork);
      result.enriched++;
      if (rename.title) result.renamed.push({ kind, id: doc._id, from: doc.title!, to: rename.title });
    }

    // Pass 2: top-level titles with no match yet.
    const docs = await col
      .find({ parentFolderId: env.driveRootFolderId, artwork: null, artworkAutoOff: { $ne: true } })
      .toArray();
    for (const doc of docs) {
      const { query, year, key } = searchFor(doc);
      const name = doc.title ?? doc.driveName;
      if (!query) continue;
      if (!retry && doc.artworkTriedFor === key) {
        result.unmatched.push({ kind, id: doc._id, name, query, year });
        continue;
      }
      const artwork = await search(kind, query, year);
      if (artwork) {
        const rename = titleUpdate(doc, artwork);
        // `artwork: null` again in the filter: an admin may have pasted a link meanwhile.
        await col.updateOne({ _id: doc._id, artwork: null }, { $set: { artwork, artworkTriedFor: key, ...rename } });
        warmImage(artwork);
        result.matched.push({ kind, id: doc._id, name, tmdbTitle: artwork.title, year: artwork.year });
        if (rename.title) result.renamed.push({ kind, id: doc._id, from: name, to: rename.title });
      } else {
        await col.updateOne({ _id: doc._id }, { $set: { artworkTriedFor: key } });
        result.unmatched.push({ kind, id: doc._id, name, query, year });
      }
    }
  }

  return result;
}

// --- Images -------------------------------------------------------------------------------------

// Backdrops are 16:9, for wide cards and the hero (w1280 is enough for a desktop hero). Posters are
// 2:3, for the web's poster-shaped cards, which ask for them with ?shape=poster.
const BACKDROP_SIZE = "w1280";
const POSTER_SIZE = "w780";
const LOGO_SIZE = "w500";
const STILL_SIZE = "w780";
const PROFILE_SIZE = "w185";

/** The frame an image is for: "wide" (16:9 cards, heroes — the default, and what every older
 * client asks for), "poster" (2:3 cards), or "logo" (the title's wordmark on transparency, which
 * unlike the others has no fallback — a title without one gets a 404 and the client writes the
 * title in text, as it always has). */
export type ArtworkShape = "wide" | "poster" | "logo";

export function parseArtworkShape(value: unknown): ArtworkShape {
  return value === "poster" ? "poster" : value === "logo" ? "logo" : "wide";
}
const TMDB_PATH_RE = /^\/[A-Za-z0-9_-]{4,64}\.(jpg|jpeg|png|webp)$/;
const DOWNLOAD_TIMEOUT_MS = 15000;

export type ArtworkImage = { tmdbPath: string; size: string };

/** Which image a title shows in a frame of this shape — the matching one when TMDb has it, else
 * the other — or null when its artwork has neither. The path is validated here because it becomes
 * part of a filename. */
export function artworkImage(
  artwork: CatalogArtwork | null | undefined,
  shape: ArtworkShape = "wide",
): ArtworkImage | null {
  const at = (path: string | null | undefined, size: string): ArtworkImage | null =>
    path && TMDB_PATH_RE.test(path) ? { tmdbPath: path, size } : null;
  // A wordmark is never substituted with a photo: half a logo treatment looks worse than none.
  if (shape === "logo") return at(artwork?.logoPath, LOGO_SIZE);
  const backdrop = at(artwork?.backdropPath, BACKDROP_SIZE);
  const poster = at(artwork?.posterPath, POSTER_SIZE);
  return shape === "poster" ? (poster ?? backdrop) : (backdrop ?? poster);
}

/** An episode's own still, for its card and the player header. Shape-independent: a still is
 * always 16:9, so a poster-shaped card crops it rather than showing the wrong picture. */
export function episodeStillImage(episode: CatalogEpisodeArtwork | null | undefined): ArtworkImage | null {
  const path = episode?.stillPath;
  return path && TMDB_PATH_RE.test(path) ? { tmdbPath: path, size: STILL_SIZE } : null;
}

/** A cast member's headshot. Served by index into the title's stored `cast`, so no client ever
 * supplies a TMDb path. */
export function castImage(artwork: CatalogArtwork | null | undefined, index: number): ArtworkImage | null {
  const path = artwork?.cast?.[index]?.profilePath;
  return path && TMDB_PATH_RE.test(path) ? { tmdbPath: path, size: PROFILE_SIZE } : null;
}

/** What a video's card and player header show, in order: its own film artwork (a top-level
 * movie), then its episode still, then — handled by the caller — Drive's own frame grab. */
export function videoImage(
  video: { artwork?: CatalogArtwork | null; episodeArtwork?: CatalogEpisodeArtwork | null },
  shape: ArtworkShape = "wide",
): ArtworkImage | null {
  if (shape === "logo") return artworkImage(video.artwork, "logo");
  return artworkImage(video.artwork, shape) ?? episodeStillImage(video.episodeArtwork);
}

type FolderImageFields = { thumbnailFileId: string | null } & ArtworkFields;

/** What a folder's card loads: its TMDb artwork whenever it has some (one consistent look across
 * the library), else the thumbnail.* image dropped in its Drive folder. Removing the artwork in
 * admin brings the Drive image back. */
export function folderImageSource(
  folder: FolderImageFields,
  shape: ArtworkShape = "wide",
): { kind: "artwork"; image: ArtworkImage } | { kind: "drive"; fileId: string } | null {
  const image = artworkImage(folder.artwork, shape);
  if (image) return { kind: "artwork", image };
  // A Drive thumbnail is a picture, never a wordmark — it can stand in for a backdrop or poster
  // but not for a logo.
  if (shape !== "logo" && folder.thumbnailFileId) return { kind: "drive", fileId: folder.thumbnailFileId };
  return null;
}

/** The `thumbnailFileId` a folder is listed with. Every client only checks it for null before
 * loading /api/thumbnail-folder/<folderId> (none uses the id itself), so a folder that has
 * artwork but no Drive image reports a non-null marker — that is what makes artwork show on an
 * app build that predates it. */
export function listedThumbnailFileId(folder: FolderImageFields): string | null {
  const source = folderImageSource(folder);
  if (!source) return null;
  return source.kind === "drive" ? source.fileId : "tmdb";
}

const inFlight = new Map<string, Promise<string | null>>();
// A download that just failed isn't retried on every card load: with TMDb's CDN down or hanging,
// each request would otherwise wait out the timeout before falling back to Drive.
const failedUntil = new Map<string, number>();
const RETRY_FAILED_AFTER_MS = 10 * 60 * 1000;

/** The image on local disk, downloaded from TMDb the first time. Null when TMDb can't be reached
 * — callers fall back to the Drive image, so an outage costs artwork, not cards. */
export function artworkImageFile(image: ArtworkImage): Promise<string | null> {
  const fileName = `${image.size}_${image.tmdbPath.slice(1)}`;
  const existing = inFlight.get(fileName);
  if (existing) return existing;
  const task = ensureImage(image, fileName, (failedUntil.get(fileName) ?? 0) > Date.now())
    .then((file) => {
      if (file) failedUntil.delete(fileName);
      else failedUntil.set(fileName, Date.now() + RETRY_FAILED_AFTER_MS);
      return file;
    })
    .finally(() => inFlight.delete(fileName));
  inFlight.set(fileName, task);
  return task;
}

async function ensureImage(image: ArtworkImage, fileName: string, recentlyFailed: boolean): Promise<string | null> {
  const dir = env.artworkDir;
  const target = join(dir, fileName);
  try {
    if ((await stat(target)).size > 0) return target;
  } catch {
    // not cached yet
  }
  if (recentlyFailed) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  const partial = join(dir, `${fileName}.${randomUUID()}.part`);
  try {
    const res = await fetch(`${env.tmdbImageBase}/${image.size}${image.tmdbPath}`, { signal: controller.signal });
    if (!res.ok || !res.body) return null;
    await mkdir(dir, { recursive: true });
    await pipeline(
      Readable.fromWeb(res.body as import("node:stream/web").ReadableStream<Uint8Array>),
      createWriteStream(partial),
    );
    await rename(partial, target);
    return target;
  } catch {
    await unlink(partial).catch(() => {});
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetches a newly matched title's images in the background, so the first person to open the
 * library doesn't wait on TMDb. All three shapes, because web asks for posters and the spotlight
 * asks for logos — one title is three small downloads, done once. */
export function warmImage(artwork: CatalogArtwork): void {
  for (const shape of ["wide", "poster", "logo"] as const) {
    const image = artworkImage(artwork, shape);
    if (image) void artworkImageFile(image);
  }
}

/** The TMDb title, when it's safe to use as this item's own title. Null means "keep what we have",
 * which is the answer unless one of two things is true:
 *
 *  - the names already are the same title, down to punctuation and case ("House of The Dragon" →
 *    "House of the Dragon", "Avengers Endgame" → "Avengers: Endgame"); or
 *  - what we have is that title plus release noise — a year, a resolution, a codec, a rip tag
 *    ("Gargi.2022.1080p.HD.mkv" → "Gargi").
 *
 * Anything else is left alone, because the difference may well be deliberate: "The Office (US)"
 * is not an untidy "The Office", and "Gargi — Director's Cut" is not "Gargi". The one thing this
 * must never do is overwrite a distinction an admin drew on purpose. */
export function cleanedTitle(current: string | null, artwork: CatalogArtwork): string | null {
  const tmdbTitle = artwork.title.trim();
  if (!tmdbTitle || !current) return null;
  if (current.trim() === tmdbTitle) return null;
  const target = normaliseTitle(tmdbTitle);
  if (normaliseTitle(current) === target) return tmdbTitle;
  const { query, year } = parseReleaseName(current);
  const hadReleaseNoise = year != null || RELEASE_JUNK_RE.test(current);
  return hadReleaseNoise && normaliseTitle(query) === target ? tmdbTitle : null;
}
