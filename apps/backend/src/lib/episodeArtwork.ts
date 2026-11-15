import { env } from "../config/env";
import { getCatalogFolder, listChildFolders, type CatalogFolder } from "./catalogFolders";
import { listVideosByParent } from "./catalogVideos";
import { getDb } from "./mongodb";
import { orderEpisodes } from "./catalogListItem";
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
type SeasonPlan = { seriesTmdbId: string; season: number };

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
async function matchFolder(
  folderId: string,
  plan: SeasonPlan,
  result: EpisodeMatchResult,
): Promise<void> {
  const videos = await listVideosByParent(folderId);
  if (videos.length === 0) return;
  const episodes = await fetchSeason(plan.seriesTmdbId, plan.season);
  if (!episodes || episodes.length === 0) return;

  const byNumber = new Map(episodes.filter((e) => e.episode_number != null).map((e) => [e.episode_number!, e]));
  const inOrder = orderEpisodes(
    videos.map((v) => ({ id: v._id, name: v.title ?? v.driveName, episodeOrder: v.episodeOrder })),
  );
  // Every video carrying its own episodeOrder means the admin (or a publish-rule apply) has
  // already said which episode each file is — trust that over position in the list.
  const everyOrdered = inOrder.every((v) => v.episodeOrder != null);

  const col = await videoCollection();
  for (let i = 0; i < inOrder.length; i++) {
    const video = videos.find((v) => v._id === inOrder[i].id)!;
    const number = everyOrdered ? inOrder[i].episodeOrder! : i + 1;
    const episode = byNumber.get(number);
    if (!episode) continue;

    const artwork = toEpisodeArtwork(episode, plan.seriesTmdbId, plan.season);
    const set: Record<string, unknown> = { episodeArtwork: artwork, updatedAt: new Date() };
    // The real name replaces "Episode 4" unless an admin typed this episode's title by hand.
    // A video with no title at all is still "pending" — giving it one here would quietly promote
    // it into the curation flow as a side effect of fetching metadata, so it only gets the data.
    if (artwork.name && video.title && !video.titleOverridden && video.title !== artwork.name) {
      set.title = artwork.name;
      result.renamed++;
    }
    await col.updateOne({ _id: video._id }, { $set: set });
    result.matched++;
    const still = episodeStillImage(artwork);
    if (still) void artworkImageFile(still);
  }
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
async function matchSeries(series: CatalogFolder, result: EpisodeMatchResult): Promise<void> {
  const seriesTmdbId = series.artwork!.tmdbId;
  // Episodes sitting straight in the series folder: season 1 unless the folder's name says
  // otherwise (a folder called "Attack on Titan" says nothing, and season 1 is the honest guess).
  const ownSeason = series.tmdbSeason ?? guessSeasonNumber(series.title, series.driveName) ?? 1;
  await matchFolder(series._id, { seriesTmdbId, season: ownSeason }, result);

  for (const child of await listChildFolders(series._id)) {
    const season = child.tmdbSeason ?? guessSeasonNumber(child.title, child.driveName);
    if (season == null) {
      result.unresolved.push({ folderId: child._id, name: child.title ?? child.driveName });
      continue;
    }
    await matchFolder(child._id, { seriesTmdbId, season }, result);
  }
}

/** Re-matches one series' episodes now, on the admin's say-so. */
export async function matchEpisodesForSeries(folderId: string): Promise<EpisodeMatchResult> {
  const folder = await getCatalogFolder(folderId);
  if (!folder) throw new ArtworkLookupError("missing", "Not found");
  if (!env.tmdbApiKey) throw new ArtworkLookupError("no-key", "TMDB_API_KEY isn't set on the server");
  if (folder.artwork?.tmdbType !== "tv") {
    throw new ArtworkLookupError("not-found", "Match this series to TMDb first, then its episodes can be named.");
  }
  const result = empty();
  await matchSeries(folder, result);
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
