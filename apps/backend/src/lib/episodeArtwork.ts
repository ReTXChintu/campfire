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
  // A bonus episode is numbered among the bonus episodes, not the season: "S02.Bonus.E03" is the
  // third bonus, which TMDb files under Specials — never regular episode 3. See parseBonusNumber.
  if (BONUS_RE.test(s)) return null;
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

const BONUS_RE = /\bbonus\b/i;
// "Bonus E03", "Bonus Ep 02", "Bonus EP1", "Bonus EP 3" — the number shortly after the word.
const BONUS_NUMBER_RE = /\bbonus\b\D{0,12}?(\d{1,3})\b/i;
const SEASON_IN_NAME_RE = /\bS(?:eason)?\s*(\d{1,2})\b/i;

/**
 * A bonus episode's season and number, from its filename ("INDIAS.GOT.LATENT.S02.Bonus.E03" →
 * season 2, bonus 3), or null when the file isn't a bonus episode. `bonus` is null for one that
 * says it's a bonus but not which ("Bonus Clip"), which can't be matched.
 */
export function parseBonusNumber(name: string): { season: number | null; bonus: number | null } | null {
  const s = name.replace(VIDEO_EXT_RE, "").replace(/[._]+/g, " ");
  if (!BONUS_RE.test(s)) return null;
  const number = s.match(BONUS_NUMBER_RE);
  const season = s.match(SEASON_IN_NAME_RE);
  return { season: season ? +season[1] : null, bonus: number ? +number[1] : null };
}

/**
 * The one TMDb special a bonus file is, or null. TMDb numbers specials in one running list across
 * every season ("Bonus EP 3" from season 1 and "S2 Bonus EP3" from season 2 are specials 4 and
 * 15), so they're matched by *name*: same bonus number, same season — where a special with no
 * season in its name counts as season 1, which is how shows name their first season's bonuses.
 * Anything short of exactly one candidate is no match.
 */
export function matchSpecial(
  specials: { episode_number?: number; name?: string | null }[],
  bonus: { season: number; bonus: number },
): number | null {
  const candidates = specials.filter((special) => {
    const name = (special.name ?? "").replace(/[._]+/g, " ");
    const number = name.match(BONUS_NUMBER_RE);
    if (!number || +number[1] !== bonus.bonus) return false;
    const season = name.match(SEASON_IN_NAME_RE);
    return (season ? +season[1] : 1) === bonus.season;
  });
  return candidates.length === 1 ? (candidates[0].episode_number ?? null) : null;
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
  /** Episodes whose earlier TMDb data turned out to be wrong, and was removed. */
  cleared: number;
  /** Folders that look like episodes of a matched series but whose season couldn't be worked out
   * from the name — an admin sets it on the series' admin page. */
  unresolved: { folderId: string; name: string }[];
};

const empty = (): EpisodeMatchResult => ({ matched: 0, renamed: 0, cleared: 0, unresolved: [] });

/** Matches every episode under one folder against `plan`'s season. Positional, in the order the
 * library itself shows them. */
type Assignment = { video: CatalogVideo; season: number; number: number };

/** How a folder's episodes were matched — "position" is the one worth checking by eye, since
 * nothing in the files themselves confirms it. */
export type MatchMethod = "filename" | "filename+gaps" | "position";

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
function assignEpisodes(
  videos: CatalogVideo[],
  plan: SeasonPlan,
): { assignments: Assignment[]; method: MatchMethod; freezeOrder?: boolean } | null {
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
      if (unreadable.length === 0) return { assignments: known, method: "filename" };

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
          return {
            assignments: [...known, ...inNameOrder.map(({ video }, i) => ({ video, season, number: gaps[i] }))],
            method: "filename+gaps",
          };
        }
      }
    }
  }

  const season = plan.season ?? plan.fallbackSeason;
  if (season == null) return null;
  const inOrder = orderEpisodes(
    videos.map((v) => ({ id: v._id, name: v.title ?? v.driveName, episodeOrder: v.episodeOrder })),
  );
  // Numbered by place in that order — never by the stored episodeOrder value itself. The order
  // is a *sort position* (an admin's drag, a publish-rule apply), and reading it as an episode
  // number goes wrong as soon as the values aren't exactly 1..n: an episode dragged to 7 in a
  // five-file folder isn't episode 7.
  //
  // When only some files have an order, the whole order is frozen as it stands (freezeOrder), so
  // the next run sorts the same way — otherwise giving the unordered files numbers, or renaming
  // them (natural sort runs on the title), reshuffles the season and remaps it on every pass.
  // An order every file already has is the admin's, and is left alone.
  const everyOrdered = inOrder.every((v) => v.episodeOrder != null);
  return {
    assignments: inOrder.map((item, i) => ({
      video: videos.find((v) => v._id === item.id)!,
      season,
      number: i + 1,
    })),
    method: "position",
    freezeOrder: !everyOrdered,
  };
}

/** Matches every episode in one folder. False when the folder's season couldn't be worked out,
 * so the caller can list it for an admin.
 *
 * Regular episodes and bonus episodes are matched separately: a bonus file never takes a regular
 * episode's number (by name or by position), and is looked for among TMDb's specials instead.
 *
 * A file this run can positively say has no match — its season's listing came back and the
 * number isn't in it, or it's a bonus with no special to match — loses any TMDb data it had. An
 * earlier, cruder pass may have given it the wrong episode, and wrong data is worse than none. A
 * file whose listing didn't come back (TMDb down) keeps what it had. */
async function matchFolder(
  folderId: string,
  plan: SeasonPlan,
  result: EpisodeMatchResult,
  force = false,
): Promise<boolean> {
  const videos = await listVideosByParent(folderId);
  if (videos.length === 0) return true;
  const regular = videos.filter((v) => !parseBonusNumber(v.driveName));
  const bonuses = videos
    .map((video) => ({ video, parsed: parseBonusNumber(video.driveName) }))
    .filter((b): b is { video: CatalogVideo; parsed: { season: number | null; bonus: number | null } } => !!b.parsed);

  const assigned = regular.length > 0 ? assignEpisodes(regular, plan) : { assignments: [], method: "filename" as const };
  if (!assigned && bonuses.length === 0) return false;
  const assignments = assigned?.assignments ?? [];
  // When the files name their own episodes, they're also the authority on order; a position-
  // matched folder with only some orders set gets its whole order frozen (see assignEpisodes).
  const ordersFromNames =
    assigned?.method === "filename" || assigned?.method === "filename+gaps" || assigned?.freezeOrder === true;

  const listings = new Map<number, Map<number, TmdbEpisode> | null>();
  const listing = async (season: number) => {
    if (!listings.has(season)) {
      const episodes = await fetchSeason(plan.seriesTmdbId, season);
      listings.set(
        season,
        episodes ? new Map(episodes.filter((e) => e.episode_number != null).map((e) => [e.episode_number!, e])) : null,
      );
    }
    return listings.get(season)!;
  };

  type Decision = { video: CatalogVideo; season: number; episode: TmdbEpisode | null; known: boolean; order: number | null; authoritative: boolean };
  const decisions: Decision[] = [];
  for (const { video, season, number } of assignments) {
    const episodes = await listing(season);
    decisions.push({
      video,
      season,
      episode: episodes?.get(number) ?? null,
      known: episodes != null,
      order: number,
      authoritative: ordersFromNames,
    });
  }

  if (bonuses.length > 0) {
    const specials = await listing(SPECIALS_SEASON);
    const regularTop = Math.max(0, ...assignments.map((a) => a.number));
    for (const { video, parsed } of bonuses) {
      const season = plan.season ?? parsed.season ?? plan.fallbackSeason;
      const number =
        specials && season != null && parsed.bonus != null
          ? matchSpecial([...specials.values()], { season, bonus: parsed.bonus })
          : null;
      decisions.push({
        video,
        season: SPECIALS_SEASON,
        episode: number != null ? (specials!.get(number) ?? null) : null,
        known: specials != null,
        // Bonuses sort after the regular episodes, in their own order.
        order: parsed.bonus != null ? regularTop + parsed.bonus : null,
        authoritative: parsed.bonus != null,
      });
    }
  }

  const col = await videoCollection();
  for (const { video, season, episode, known, order, authoritative } of decisions) {
    if (!episode) {
      if (known && video.episodeArtwork) {
        await col.updateOne({ _id: video._id }, { $unset: { episodeArtwork: "" }, $set: { updatedAt: new Date() } });
        result.cleared++;
      }
      continue;
    }

    const artwork = toEpisodeArtwork(episode, plan.seriesTmdbId, season);
    const set: Record<string, unknown> = { episodeArtwork: artwork, updatedAt: new Date() };
    // episodeOrder is what the library sorts by. A file that names its own episode decides its
    // place outright — which also repairs an order a positional pass got wrong. Otherwise an
    // unordered episode gets its number (so renaming it can't scatter a season alphabetically),
    // and an order that's already set is left where an admin may have dragged it.
    if (order != null && (authoritative || video.episodeOrder == null) && video.episodeOrder !== order) {
      set.episodeOrder = order;
    }
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

/** One season's part of a publish preview. */
export type PublishSeason = {
  folderId: string;
  name: string;
  /** The season folder itself isn't published yet, so publishing its episodes publishes it too —
   * an unpublished folder hides everything in it. */
  publishesFolder: boolean;
  /** How these episodes were matched. "position" means nothing in the files confirms the names,
   * so they're worth a look before viewers see them. */
  matchedBy: MatchMethod | null;
  episodes: { id: string; episode: number | null; name: string }[];
};

export type PublishResult = {
  seasons: PublishSeason[];
  /** Episodes this leaves alone, and why — so the admin knows what still needs them. */
  skipped: { id: string; name: string; reason: "no-tmdb-name" | "held-back" | "folder-held-back" }[];
  /** The series folder itself isn't published, so none of this is visible yet whatever happens. */
  seriesHidden: boolean;
  published: boolean;
};

/**
 * Publishes the episodes of one series that nobody ever curated but TMDb has since named — the
 * pile a library accumulates when a season is uploaded and never gone through by hand.
 *
 * Deliberately narrow:
 *  - Only *pending* episodes (never touched). One that's curated but unpublished was held back on
 *    purpose — "curated" is how an admin checks subtitles and timing first — so it stays put. The
 *    same goes for a season folder that's curated but unpublished.
 *  - Only episodes TMDb actually named. The rest are reported, not guessed at.
 *  - With `dryRun`, nothing is written: the preview is how an admin catches a season matched by
 *    position (which nothing in the files confirms) before its names go out to every viewer.
 */
export async function publishNamedEpisodes(
  seriesFolderId: string,
  options: { dryRun: boolean; curatedBy: string },
): Promise<PublishResult> {
  const series = await getCatalogFolder(seriesFolderId);
  if (!series) throw new ArtworkLookupError("missing", "Not found");
  if (series.artwork?.tmdbType !== "tv") {
    throw new ArtworkLookupError("not-found", "Match this series to TMDb first, then its episodes can be named.");
  }

  const result: PublishResult = {
    seasons: [],
    skipped: [],
    seriesHidden: series.status !== "published",
    published: false,
  };
  const folders = [series, ...(await listChildFolders(series._id))];
  const writes: { videoIds: string[]; folder: CatalogFolder | null; titles: Map<string, string> }[] = [];

  for (const folder of folders) {
    const videos = await listVideosByParent(folder._id);
    const pending = videos.filter((v) => v.status === "pending");
    if (pending.length === 0) continue;

    // A held-back season folder holds back everything in it.
    const isSeries = folder._id === series._id;
    if (!isSeries && folder.status === "curated") {
      for (const v of pending) result.skipped.push({ id: v._id, name: v.driveName, reason: "folder-held-back" });
      continue;
    }

    const named = pending.filter((v) => v.episodeArtwork?.name);
    for (const v of pending) if (!v.episodeArtwork?.name) result.skipped.push({ id: v._id, name: v.driveName, reason: "no-tmdb-name" });
    if (named.length === 0) continue;

    const plan: SeasonPlan = {
      seriesTmdbId: series.artwork.tmdbId,
      season: folder.tmdbSeason ?? guessSeasonNumber(folder.title, folder.driveName),
      fallbackSeason: isSeries ? 1 : null,
    };
    const method = assignEpisodes(videos, plan)?.method ?? null;

    named.sort((a, b) => (a.episodeArtwork!.episode ?? 0) - (b.episodeArtwork!.episode ?? 0));
    result.seasons.push({
      folderId: folder._id,
      name: folder.title ?? folder.driveName,
      publishesFolder: !isSeries && folder.status !== "published",
      matchedBy: method,
      episodes: named.map((v) => ({ id: v._id, episode: v.episodeArtwork!.episode || null, name: v.episodeArtwork!.name! })),
    });
    writes.push({
      videoIds: named.map((v) => v._id),
      folder: !isSeries && folder.status !== "published" ? folder : null,
      titles: new Map(named.map((v) => [v._id, v.episodeArtwork!.name!])),
    });
  }

  for (const v of await videosHeldBack(folders)) result.skipped.push({ id: v._id, name: v.title ?? v.driveName, reason: "held-back" });
  if (options.dryRun || writes.length === 0) return result;

  const videoCol = await videoCollection();
  const folderCol = await folderCollection();
  const now = new Date();
  for (const { videoIds, folder, titles } of writes) {
    for (const id of videoIds) {
      // `status: "pending"` in the filter as well: an admin may have curated it since the preview.
      await videoCol.updateOne(
        { _id: id, status: "pending" },
        {
          $set: {
            title: titles.get(id),
            titleOverridden: false,
            status: "published",
            curatedAt: now,
            curatedBy: options.curatedBy,
            updatedAt: now,
          },
        },
      );
    }
    if (folder) {
      await folderCol.updateOne(
        { _id: folder._id, status: { $in: ["pending", "curated"] } },
        {
          $set: {
            // A pending folder has no title yet; its Drive name ("Season 5") is the honest one.
            title: folder.title ?? folder.driveName,
            status: "published",
            curatedAt: folder.curatedAt ?? now,
            curatedBy: folder.curatedBy ?? options.curatedBy,
            updatedAt: now,
          },
        },
      );
    }
  }
  result.published = true;
  return result;
}

/** Curated-but-unpublished episodes, which publishing leaves alone and the preview mentions. */
async function videosHeldBack(folders: CatalogFolder[]): Promise<CatalogVideo[]> {
  const held: CatalogVideo[] = [];
  for (const folder of folders) {
    held.push(...(await listVideosByParent(folder._id)).filter((v) => v.status === "curated"));
  }
  return held;
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
