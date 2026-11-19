import { env } from "../config/env";
import { getCatalogFolder, listChildFolders, type CatalogFolder } from "./catalogFolders";
import { listVideosByParent, type CatalogVideo } from "./catalogVideos";
import { getDb } from "./mongodb";
import { naturalSort, orderEpisodes } from "./catalogListItem";
import { tmdbFetch } from "./referenceLink";
import {
  ArtworkLookupError,
  artworkImageFile,
  autoMatchArtwork,
  episodeStillImage,
  type AutoMatchResult,
  type CatalogEpisodeArtwork,
} from "./artwork";

/** Episode-level TMDb data: each episode's real name, its synopsis and its own still frame, for a
 * series whose folder is already matched (see lib/artwork.ts, which does the title-level match
 * this builds on).
 *
 * TMDb identifies an episode by season and number, and Drive gives us neither — only a folder of
 * files in some order. So the mapping is positional: the videos in a folder, in the order the
 * library already shows them (episodeOrder, else natural sort), line up with that season's
 * episodes in number order. That is right for a normal season folder and wrong for a folder
 * missing episode 3, which is why a season is only ever matched when the counts make sense and
 * why every episode's name is visible (and removable) in admin.
 *
 * Which season a folder holds is guessed from its name ("Season 2", "S02") and stored on the
 * folder as `tmdbSeason`, so an admin can correct it once and have it stick. */

const SPECIALS_SEASON = 0;

/** The season number a folder's name says it holds, or null when it says nothing. Covers the
 * shapes that actually turn up in a Drive library: "Season 2", "season 02", "S2", "S02",
 * "Series 2", a bare "2", and "Specials"/"Extras" for season 0.
 *
 * Takes the names in order and uses the first that says something, which is why callers pass the
 * curated title *and* the Drive name: matching a series rewrites its title to TMDb's clean one
 * ("India's got Latent s2" → "India's Got Latent"), and that is exactly where the season number
 * lived. The Drive name is never rewritten, so it keeps the hint. */
export function guessSeasonNumber(...names: (string | null | undefined)[]): number | null {
  for (const name of names) {
    const found = name ? seasonInName(name) : null;
    if (found != null) return found;
  }
  return null;
}

function seasonInName(name: string): number | null {
  const cleaned = name.replace(/[._]+/g, " ").trim();
  if (/^(specials?|extras?|bonus)\b/i.test(cleaned)) return SPECIALS_SEASON;
  const labelled = cleaned.match(/\b(?:season|series|sea|s)\s*[-_ ]?(\d{1,2})\b/i);
  if (labelled) return Number(labelled[1]);
  const bare = cleaned.match(/^(\d{1,2})$/);
  if (bare) return Number(bare[1]);
  return null;
}

const VIDEO_EXT_RE = /\.(mkv|mp4|m4v|avi|mov|webm|ts|wmv|flv|mpg|mpeg)$/i;

/**
 * Which episode a file says it is, from its name: "S01E04", "S1 E4", "AOT S1 - 04" (the usual
 * anime convention), "1x04", "Season 1 Episode 4", or just "Episode 4" / "E04" (no season). Null
 * when the name says nothing usable.
 *
 * Only ever given a *Drive filename*, never a curated title — titles come from publish-rule
 * patterns, and those can be wrong in ways a filename usually isn't (this library has a whole
 * season 2 titled "S1E1: AOT", "S1E2: AOT"…).
 *
 * "S4P1E1" is deliberately unreadable: it numbers an episode within one *part* of a season, while
 * TMDb numbers the whole season straight through, and how long part 1 was isn't in the name.
 */
export function parseEpisodeNumber(name: string): { season: number | null; episode: number } | null {
  const s = name.replace(VIDEO_EXT_RE, "").replace(/[._]+/g, " ");
  if (/\bS\d{1,2}\s*P\d{1,2}\s*E\d{1,3}\b/i.test(s)) return null;

  const patterns: [RegExp, (m: RegExpMatchArray) => { season: number | null; episode: number }][] = [
    [/\bS(\d{1,2})\s*-?\s*E(\d{1,3})\b/i, (m) => ({ season: +m[1], episode: +m[2] })],
    [/\bS(\d{1,2})\s*-\s*(\d{1,3})\b/i, (m) => ({ season: +m[1], episode: +m[2] })],
    [/\b(\d{1,2})x(\d{2,3})\b/i, (m) => ({ season: +m[1], episode: +m[2] })],
    [/\bSeason\s*(\d{1,2})\s*-?\s*Episode\s*(\d{1,3})\b/i, (m) => ({ season: +m[1], episode: +m[2] })],
    [/\b(?:Episode|Ep)\s*(\d{1,3})\b/i, (m) => ({ season: null, episode: +m[1] })],
    [/\bE(\d{1,3})\b/i, (m) => ({ season: null, episode: +m[1] })],
  ];
  for (const [re, read] of patterns) {
    const m = s.match(re);
    if (!m) continue;
    const parsed = read(m);
    // TMDb numbers episodes from 1; an "E00" is a pilot or an extra, not something to map.
    return parsed.episode >= 1 ? parsed : null;
  }
  return null;
}

type TmdbEpisode = {
  episode_number?: number;
  name?: string | null;
  overview?: string | null;
  still_path?: string | null;
  air_date?: string | null;
  runtime?: number | null;
  vote_average?: number;
  vote_count?: number;
};

async function fetchSeason(seriesTmdbId: string, season: number): Promise<TmdbEpisode[] | null> {
  const data = await tmdbFetch<{ episodes?: TmdbEpisode[] }>(`/tv/${seriesTmdbId}/season/${season}`, {});
  return data?.episodes ?? null;
}

function toEpisodeArtwork(e: TmdbEpisode, seriesTmdbId: string, season: number): CatalogEpisodeArtwork {
  const count = e.vote_count ?? 0;
  return {
    seriesTmdbId,
    season,
    episode: e.episode_number ?? 0,
    name: e.name?.trim() || null,
    overview: e.overview?.trim() || null,
    stillPath: e.still_path || null,
    airDate: e.air_date || null,
    runtimeMinutes: typeof e.runtime === "number" && e.runtime > 0 ? e.runtime : null,
    rating:
      typeof e.vote_average === "number" && e.vote_average > 0 && count > 0
        ? { average: Math.round(e.vote_average * 10) / 10, count }
        : null,
    matchedAt: new Date(),
  };
}

/** One folder of episodes: which series they belong to and which season they are. The series is
 * the nearest ancestor (or the folder itself) with a matched TV title. */
/** One folder of episodes. `season` is a real signal — set by an admin or read from the folder's
 * name — and outranks anything a filename says. `fallbackSeason` is only a default (a series whose
 * episodes sit directly in it is assumed to be season 1), so a filename's season beats it. */
type SeasonPlan = { seriesTmdbId: string; season: number | null; fallbackSeason: number | null };

async function videoCollection() {
  return (await getDb()).collection<{ _id: string }>("catalogVideos");
}

async function folderCollection() {
  return (await getDb()).collection<{ _id: string }>("catalogFolders");
}

export type EpisodeMatchResult = {
  /** Episodes that got a name, synopsis or still. */
  matched: number;
  /** Episodes renamed to their TMDb name. */
  renamed: number;
  /** Folders that look like episodes of a matched series but whose season couldn't be worked out
   * from the name — an admin sets it on the series' admin page. */
  unresolved: { folderId: string; name: string }[];
};

const empty = (): EpisodeMatchResult => ({ matched: 0, renamed: 0, unresolved: [] });

/** Matches every episode under one folder against `plan`'s season. Positional, in the order the
 * library itself shows them. */
type Assignment = { video: CatalogVideo; season: number; number: number };

/**
 * Which TMDb episode each video in a folder is. Three ways, best first:
 *
 *  1. **By filename**, when every file names its own episode ("S01E04") and no two name the same
 *     one. This survives a missing episode or a file out of order, which position can't: files
 *     E1, E2, E4 map to 1, 2 and 4, not 1, 2 and 3.
 *  2. **By filename, filling the gaps**, when only some names are readable. Readable files keep
 *     their numbers; the unreadable ones take the numbers left over, in name order — but only when
 *     there are exactly as many leftover numbers as unreadable files. That is this library's Game
 *     of Thrones season 5: episodes 5–10 properly named, 1–4 uploaded as DOS short names
 *     ("GAMEOF~1.MKV"…). Position would sort the readable names first and call the S05E05 file
 *     episode 1; filling the gaps gets every one right.
 *  3. **By position**, as before: the order the library already shows them in (episodeOrder when
 *     every video has one, natural sort otherwise), lined up with that season from episode 1.
 *
 * Null when the folder's season can't be worked out at all.
 */
function assignEpisodes(videos: CatalogVideo[], plan: SeasonPlan): Assignment[] | null {
  const parsed = videos.map((video) => ({ video, name: parseEpisodeNumber(video.driveName) }));
  const readable = parsed.filter((p) => p.name);
  const unreadable = parsed.filter((p) => !p.name).map((p) => p.video);

  if (readable.length > 0) {
    const assigned = readable.map(({ video, name }) => ({
      video,
      season: plan.season ?? name!.season ?? plan.fallbackSeason,
      number: name!.episode,
    }));
    const unique = new Set(assigned.map((a) => `${a.season}|${a.number}`)).size === assigned.length;
    if (unique && assigned.every((a) => a.season != null)) {
      const known = assigned as Assignment[];
      if (unreadable.length === 0) return known;

      // Filling gaps only makes sense within a single season.
      const seasons = new Set(known.map((a) => a.season));
      if (seasons.size === 1) {
        const season = known[0].season;
        const taken = new Set(known.map((a) => a.number));
        const top = Math.max(videos.length, ...taken);
        const gaps: number[] = [];
        for (let n = 1; n <= top; n++) if (!taken.has(n)) gaps.push(n);
        // An exact fit or nothing: with more gaps than files there's no telling which are missing.
        if (gaps.length === unreadable.length) {
          const inNameOrder = naturalSort(unreadable.map((video) => ({ name: video.driveName, video })));
          return [...known, ...inNameOrder.map(({ video }, i) => ({ video, season, number: gaps[i] }))];
        }
      }
    }
  }

  const season = plan.season ?? plan.fallbackSeason;
  if (season == null) return null;
  const inOrder = orderEpisodes(
    videos.map((v) => ({ id: v._id, name: v.title ?? v.driveName, episodeOrder: v.episodeOrder })),
  );
  // Every video carrying its own episodeOrder means the admin (or a publish-rule apply) has
  // already said which episode each file is — trust that over position in the list.
  const everyOrdered = inOrder.every((v) => v.episodeOrder != null);
  return inOrder.map((item, i) => ({
    video: videos.find((v) => v._id === item.id)!,
    season,
    number: everyOrdered ? item.episodeOrder! : i + 1,
  }));
}

/** Matches every episode in one folder. False when the folder's season couldn't be worked out,
 * so the caller can list it for an admin. */
async function matchFolder(
  folderId: string,
  plan: SeasonPlan,
  result: EpisodeMatchResult,
  force = false,
): Promise<boolean> {
  const videos = await listVideosByParent(folderId);
  if (videos.length === 0) return true;
  const assignments = assignEpisodes(videos, plan);
  if (!assignments) return false;

  // Usually one season per folder, but a flat folder named by its files can hold several.
  const seasons = new Map<number, Map<number, TmdbEpisode> | null>();
  for (const season of new Set(assignments.map((a) => a.season))) {
    const episodes = await fetchSeason(plan.seriesTmdbId, season);
    seasons.set(
      season,
      episodes ? new Map(episodes.filter((e) => e.episode_number != null).map((e) => [e.episode_number!, e])) : null,
    );
  }

  const col = await videoCollection();
  for (const { video, season, number } of assignments) {
    const episode = seasons.get(season)?.get(number);
    if (!episode) continue;

    const artwork = toEpisodeArtwork(episode, plan.seriesTmdbId, season);
    const set: Record<string, unknown> = { episodeArtwork: artwork, updatedAt: new Date() };
    // Give an unordered episode its number as its episodeOrder, which is what the library sorts
    // by. Without it, such an episode was held in place only by its own name sorting ("S1E1…",
    // "S1E2…") — and renaming it to "The Rogue Prince" would scatter the season alphabetically.
    // An order that's already set is left alone: an admin may have dragged it there on purpose.
    if (video.episodeOrder == null) set.episodeOrder = number;
    // The real name replaces "Episode 4" unless an admin typed this episode's title by hand —
    // `force` is an admin saying to do it anyway, and then the name stops counting as hand-typed
    // so later passes can keep it current.
    //
    // A video with no title at all is still "pending" either way: giving it one here would
    // quietly promote it into the curation flow as a side effect of fetching metadata.
    if (artwork.name && video.title && video.title !== artwork.name && (force || !video.titleOverridden)) {
      set.title = artwork.name;
      if (video.titleOverridden) set.titleOverridden = false;
      result.renamed++;
    }
    await col.updateOne({ _id: video._id }, { $set: set });
    result.matched++;
    const still = episodeStillImage(artwork);
    if (still) void artworkImageFile(still);
  }
  return true;
}

/** Every episode of every matched series. Skips a series whose artwork an admin removed, and one
 * whose episode naming they turned off. */
export async function matchAllEpisodes(): Promise<EpisodeMatchResult> {
  const result = empty();
  if (!env.tmdbApiKey) return result;

  const roots = await listChildFolders(env.driveRootFolderId);
  for (const root of roots) {
    if (root.artwork?.tmdbType !== "tv" || root.episodeArtworkOff) continue;
    await matchSeries(root, result);
  }
  return result;
}

/** Admin set (or cleared) which season a folder holds, then re-matched it. */
export async function setFolderSeason(folderId: string, season: number | null): Promise<EpisodeMatchResult> {
  const folder = await getCatalogFolder(folderId);
  if (!folder) throw new ArtworkLookupError("missing", "Not found");
  const folders = await folderCollection();
  await folders.updateOne({ _id: folderId }, { $set: { tmdbSeason: season, updatedAt: new Date() } });
  return matchEpisodesForSeries(folder.parentFolderId === env.driveRootFolderId ? folderId : folder.parentFolderId);
}

/** Admin turned episode naming on or off for one series. Turning it off leaves the names already
 * applied in place — undoing a rename isn't something we can do, and silently reverting to
 * "Episode 1" would be worse than leaving the real names. */
export async function setEpisodeArtworkEnabled(folderId: string, enabled: boolean): Promise<void> {
  const folder = await getCatalogFolder(folderId);
  if (!folder) throw new ArtworkLookupError("missing", "Not found");
  const folders = await folderCollection();
  await folders.updateOne({ _id: folderId }, { $set: { episodeArtworkOff: !enabled, updatedAt: new Date() } });
}

/** One matched series: the episodes directly inside it, then each season subfolder's. */
async function matchSeries(series: CatalogFolder, result: EpisodeMatchResult, force = false): Promise<void> {
  const seriesTmdbId = series.artwork!.tmdbId;
  // Episodes sitting straight in the series folder. A folder called "Attack on Titan" says nothing
  // about seasons, so season 1 is only a fallback — files that name their own season win over it.
  await matchFolder(
    series._id,
    {
      seriesTmdbId,
      season: series.tmdbSeason ?? guessSeasonNumber(series.title, series.driveName),
      fallbackSeason: 1,
    },
    result,
    force,
  );

  for (const child of await listChildFolders(series._id)) {
    // No fallback for a subfolder: one whose name says nothing ("Behind The Scenes") is only
    // matched if every file in it names its own season, and is otherwise listed for an admin.
    const placed = await matchFolder(
      child._id,
      { seriesTmdbId, season: child.tmdbSeason ?? guessSeasonNumber(child.title, child.driveName), fallbackSeason: null },
      result,
      force,
    );
    if (!placed) result.unresolved.push({ folderId: child._id, name: child.title ?? child.driveName });
  }
}

/** Re-matches one series' episodes now, on the admin's say-so. With `force`, episode titles an
 * admin typed by hand are replaced too — the deliberate version of the same button. */
export async function matchEpisodesForSeries(
  folderId: string,
  options: { force?: boolean } = {},
): Promise<EpisodeMatchResult> {
  const folder = await getCatalogFolder(folderId);
  if (!folder) throw new ArtworkLookupError("missing", "Not found");
  if (!env.tmdbApiKey) throw new ArtworkLookupError("no-key", "TMDB_API_KEY isn't set on the server");
  if (folder.artwork?.tmdbType !== "tv") {
    throw new ArtworkLookupError("not-found", "Match this series to TMDb first, then its episodes can be named.");
  }
  const result = empty();
  await matchSeries(folder, result, options.force ?? false);
  return result;
}

export type CatalogMatchResult = AutoMatchResult & { episodes: EpisodeMatchResult };

/** The whole catalog's TMDb pass: titles first (lib/artwork.ts), then the episodes underneath
 * them, which need those title matches to exist. This is what the startup hook, a scan and the
 * admin button all call. */
export async function matchCatalog(options: { retry?: boolean } = {}): Promise<CatalogMatchResult> {
  const titles = await autoMatchArtwork(options);
  if (titles.skipped === "no-key") return { ...titles, episodes: empty() };
  return { ...titles, episodes: await matchAllEpisodes() };
}
