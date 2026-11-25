import { env } from "../config/env";
import { isAdminEmail } from "./admin";
import type { CatalogArtwork, CatalogEpisodeArtwork } from "./artwork";
import { getCatalogVideo, type CatalogVideo } from "./catalogVideos";
import { titleMeta, episodeMeta } from "./catalogMeta";
import { billed, logoPathFrom, rawDetail, ratingOf, tmdbCached, yearOf } from "./explore";
import { getDb } from "./mongodb";
import type { WatchProgress } from "./progress";
import { findByTmdb, parseTitleId, titleId, tmdbKey, type TmdbRef } from "./tmdbRef";
import type { UpNextItem } from "./upNext";
import { listViewerSources, playersFor } from "./videoSources";

/**
 * Playing any title on TMDb, in the library or not, from the source the viewer picks. One the library
 * has plays as the library's video. One it hasn't is played by its own id ("tmdb:movie:603",
 * "tmdb:tv:1396:s1e2"); its watch progress is kept under that id. Whether the source has it is asked
 * when it's picked (lib/videoSources.ts).
 */

const SEASON_TTL_MS = 6 * 60 * 60_000;
const CAST_SIZE = 10;

type TmdbEpisode = {
  episode_number: number;
  name?: string;
  overview?: string;
  still_path?: string | null;
  air_date?: string | null;
  runtime?: number | null;
  vote_average?: number;
  vote_count?: number;
};

export type SeasonEpisode = {
  number: number;
  name: string;
  overview: string | null;
  stillPath: string | null;
  airDate: string | null;
  runtimeMinutes: number | null;
  rating: { average: number; count: number } | null;
};

type SeriesProgress = Map<string, Pick<WatchProgress, "fileId" | "positionSeconds" | "durationSeconds" | "completed" | "updatedAt">>;
const spot = (season: number, episode: number) => `s${season}e${episode}`;
const today = () => new Date().toISOString().slice(0, 10);
const hasAired = (e: SeasonEpisode) => e.airDate !== null && e.airDate <= today();

async function seasonEpisodes(seriesId: string, season: number): Promise<SeasonEpisode[]> {
  const raw = await tmdbCached<{ episodes?: TmdbEpisode[] }>(`/tv/${seriesId}/season/${season}`, { language: "en-US" }, SEASON_TTL_MS);
  return (raw?.episodes ?? []).map((e) => ({
    number: e.episode_number,
    name: e.name?.trim() || `Episode ${e.episode_number}`,
    overview: e.overview?.trim() || null,
    stillPath: e.still_path ?? null,
    airDate: e.air_date || null,
    runtimeMinutes: e.runtime || null,
    rating: e.vote_average && e.vote_count ? { average: Math.round(e.vote_average * 10) / 10, count: e.vote_count } : null,
  }));
}

/** The series' seasons in viewing order, specials last. */
async function seasonsOf(seriesId: string) {
  const raw = await rawDetail("tv", seriesId);
  return (raw?.seasons ?? [])
    .filter((s) => (s.episode_count ?? 0) > 0)
    .map((s) => ({ number: s.season_number, name: s.name?.trim() || `Season ${s.season_number}`, count: s.episode_count ?? 0 }))
    .sort((a, b) => (a.number || 1000) - (b.number || 1000));
}

// ---- A title as a video -----------------------------------------------------------------------------

async function artworkOf(ref: TmdbRef): Promise<CatalogArtwork | null> {
  const raw = await rawDetail(ref.type, ref.id);
  const title = (raw?.title || raw?.name || "").trim();
  if (!raw || !title) return null;
  const rating = ratingOf(raw);
  return {
    source: "auto",
    tmdbType: ref.type,
    tmdbId: ref.id,
    title,
    year: yearOf(raw.release_date || raw.first_air_date),
    overview: raw.overview?.trim() || null,
    backdropPath: raw.backdrop_path ?? null,
    posterPath: raw.poster_path ?? null,
    matchedAt: new Date(0),
    tagline: raw.tagline?.trim() || null,
    runtimeMinutes: raw.runtime || raw.episode_run_time?.[0] || null,
    genres: (raw.genres ?? []).map((g) => g.name).slice(0, 3),
    certificate: null,
    rating: rating === null ? null : { average: rating, count: raw.vote_count ?? 0 },
    logoPath: logoPathFrom(raw.images?.logos),
    cast: billed(raw)
      .slice(0, CAST_SIZE)
      .map((c) => ({ name: c.name, character: c.character?.trim() || null, profilePath: c.profile_path ?? null })),
  };
}

/** A title the library doesn't have, in the shape of a library video. Null when TMDb has no such
 * title or episode, or isn't answering. */
async function titleVideo(ref: TmdbRef): Promise<CatalogVideo | null> {
  const artwork = await artworkOf(ref);
  if (!artwork) return null;
  let episode: CatalogEpisodeArtwork | null = null;
  if (ref.type === "tv") {
    if (ref.season == null || ref.episode == null) return null;
    const found = (await seasonEpisodes(ref.id, ref.season)).find((e) => e.number === ref.episode);
    if (!found) return null;
    episode = {
      seriesTmdbId: ref.id,
      season: ref.season,
      episode: ref.episode,
      name: found.name,
      overview: found.overview,
      stillPath: found.stillPath ?? artwork.backdropPath,
      airDate: found.airDate,
      runtimeMinutes: found.runtimeMinutes,
      rating: found.rating,
      matchedAt: new Date(0),
    };
  }
  const title = episode ? episode.name : artwork.title;
  return {
    _id: titleId(ref),
    parentFolderId: episode ? `tmdb:tv:${ref.id}` : "tmdb:movie",
    driveName: title ?? artwork.title,
    mimeType: "video/stream",
    sizeBytes: null,
    durationSeconds: null,
    status: "published",
    title,
    subtitleSetIds: [],
    introStart: null,
    introEnd: null,
    outroStart: null,
    episodeOrder: null,
    titleOverridden: false,
    introOverridden: false,
    renditions: {},
    createdAt: new Date(0),
    curatedAt: null,
    curatedBy: null,
    updatedAt: new Date(0),
    ...(episode ? { episodeArtwork: episode } : { artwork }),
  };
}

/** A video by its id, or a title by its own. */
export async function getVideoOrTitle(id: string): Promise<CatalogVideo | null> {
  const ref = parseTitleId(id);
  return ref ? titleVideo(ref) : getCatalogVideo(id);
}

/** The catalog's videos that are this title or episode, whatever their status. */
async function catalogVideosOf(ref: TmdbRef): Promise<CatalogVideo[]> {
  const query =
    ref.season != null && ref.episode != null
      ? { "episodeArtwork.seriesTmdbId": ref.id, "episodeArtwork.season": ref.season, "episodeArtwork.episode": ref.episode }
      : { "artwork.tmdbType": ref.type, "artwork.tmdbId": ref.id };
  return (await getDb()).collection<CatalogVideo>("catalogVideos").find(query).toArray();
}

/** The video or title a viewer may play by this id; null for one they may not. What an admin hasn't
 * published stays the admin's, by its title's id too. */
export async function playableVideo(id: string, email: string): Promise<CatalogVideo | null> {
  const admin = isAdminEmail(email);
  const ref = parseTitleId(id);
  if (ref) {
    if (!admin) {
      const known = await catalogVideosOf(ref);
      if (known.length > 0 && !known.some((v) => v.status === "published")) return null;
    }
    return titleVideo(ref);
  }
  const video = await getCatalogVideo(id);
  return video && (video.status === "published" || (video.status === "curated" && admin)) ? video : null;
}

/** Where a title plays: the library's own page for it, or the title's. */
async function hrefOf(ref: TmdbRef): Promise<string> {
  const found = await findByTmdb(ref);
  if (found) return found.kind === "folder" ? `/folder/${found.id}` : `/watch/${found.id}`;
  return `/watch/${titleId(ref)}`;
}

// ---- A series ---------------------------------------------------------------------------------------

/** The viewer's progress on every episode of a series, the library's and others, by "s1e2". */
async function seriesProgress(userId: string, seriesId: string): Promise<SeriesProgress> {
  const db = await getDb();
  const videos = await db
    .collection<CatalogVideo>("catalogVideos")
    .find({ "episodeArtwork.seriesTmdbId": seriesId }, { projection: { episodeArtwork: 1 } })
    .toArray();
  const spots = new Map(videos.map((v) => [v._id, spot(v.episodeArtwork!.season, v.episodeArtwork!.episode)]));
  const docs = await db
    .collection<WatchProgress>("watchProgress")
    .find({ userId, $or: [{ fileId: { $in: [...spots.keys()] } }, { fileId: { $regex: `^tmdb:tv:${seriesId}:` } }] })
    .sort({ updatedAt: 1 })
    .toArray();
  const progress: SeriesProgress = new Map();
  for (const doc of docs) {
    const ref = parseTitleId(doc.fileId);
    const key = ref ? spot(ref.season!, ref.episode!) : spots.get(doc.fileId);
    // The same episode under both: the later one counts.
    if (key) progress.set(key, doc);
  }
  return progress;
}

async function episodeAfter(seriesId: string, season: number, episode: number) {
  const rest = (await seasonEpisodes(seriesId, season)).find((e) => e.number > episode);
  if (rest) return { season, episode: rest, newSeason: false };
  const next = (await seasonsOf(seriesId)).find((s) => s.number > season);
  const first = next && season > 0 ? (await seasonEpisodes(seriesId, next.number))[0] : undefined;
  return next && first ? { season: next.number, episode: first, newSeason: true } : null;
}

async function episodeBefore(seriesId: string, season: number, episode: number) {
  const earlier = (await seasonEpisodes(seriesId, season)).filter((e) => e.number < episode).at(-1);
  if (earlier) return { season, episode: earlier };
  if (season <= 1) return null;
  const last = (await seasonEpisodes(seriesId, season - 1)).at(-1);
  return last ? { season: season - 1, episode: last } : null;
}

/** Where a viewer carries on with a series: the episode they're in, the one after the last they
 * finished, else the first. */
async function resumeSpot(seriesId: string, progress: SeriesProgress) {
  const last = [...progress].sort((a, b) => b[1].updatedAt.getTime() - a[1].updatedAt.getTime())[0];
  const at = last?.[0].match(/^s(\d+)e(\d+)$/);
  if (at) {
    const season = Number(at[1]);
    const episode = Number(at[2]);
    if (!last[1].completed) return { season, episode, started: true };
    const next = await episodeAfter(seriesId, season, episode);
    if (next && hasAired(next.episode)) return { season: next.season, episode: next.episode.number, started: true };
  }
  const first = (await seasonsOf(seriesId))[0]?.number ?? 1;
  return { season: first, episode: (await seasonEpisodes(seriesId, first))[0]?.number ?? 1, started: false };
}

/** A season of a series with the viewer's progress, for the episode list. Null when TMDb has no such
 * series or isn't answering. */
export async function seriesEpisodes(userId: string, seriesId: string, wanted: number | null) {
  const seasons = await seasonsOf(seriesId);
  if (seasons.length === 0) return null;
  const progress = await seriesProgress(userId, seriesId);
  const resume = await resumeSpot(seriesId, progress);
  const season = seasons.some((s) => s.number === wanted) ? wanted! : seasons.some((s) => s.number === resume.season) ? resume.season : seasons[0].number;
  const episodes = await seasonEpisodes(seriesId, season);
  return {
    seasons,
    season,
    resume,
    episodes: episodes.map(({ stillPath, ...e }) => {
      const p = progress.get(spot(season, e.number));
      return {
        ...e,
        aired: hasAired({ ...e, stillPath }),
        stillUrl: stillPath ? `${env.tmdbImageBase}/w300${stillPath}` : null,
        progress: p ? { positionSeconds: p.positionSeconds, durationSeconds: p.durationSeconds, completed: p.completed } : null,
      };
    }),
  };
}

/** The film or episode Play means: for a series, where the viewer stopped, else its first. */
async function whatPlays(userId: string, ref: TmdbRef): Promise<TmdbRef> {
  if (ref.type !== "tv" || ref.episode != null) return ref;
  const { season, episode } = await resumeSpot(ref.id, await seriesProgress(userId, ref.id));
  return { ...ref, season, episode };
}

/** What Play opens for a title. Null when TMDb has no such title or isn't answering and the library
 * doesn't have it either. */
export async function playTarget(userId: string, wanted: TmdbRef): Promise<{ href: string } | null> {
  const ref = await whatPlays(userId, wanted);
  const href = await hrefOf(ref);
  return parseTitleId(href.replace(/^\/watch\//, "")) && !(await titleVideo(ref)) ? null : { href };
}

// ---- Watching ---------------------------------------------------------------------------------------

/** GET /api/video for a title the library doesn't have, in the same shape as for one it has. One
 * that's in the library by now says where (`movedTo`). */
export async function titleVideoResponse(userId: string, video: CatalogVideo) {
  const ref = parseTitleId(video._id)!;
  const moved = await findByTmdb(ref);
  if (moved) return { movedTo: moved.kind === "folder" ? `/folder/${moved.id}` : `/watch/${moved.id}` };

  const db = await getDb();
  const own = await db.collection<WatchProgress>("watchProgress").findOne({ userId, fileId: video._id });
  const [players, sources] = await Promise.all([playersFor(video, { all: true }), listViewerSources()]);

  let series: CatalogArtwork | null = null;
  let upNext: UpNextItem | null = null;
  let previous: string | null = null;
  let episodes: { kind: "video"; id: string; name: string; mimeType: string; episodeNumber: number }[] = [];
  let progressByFileId: Record<string, { positionSeconds: number; durationSeconds: number; completed: boolean }> = {};
  if (ref.type === "tv") {
    const season = ref.season!;
    const number = ref.episode!;
    const [artwork, list, next, before, progress] = await Promise.all([
      artworkOf({ type: "tv", id: ref.id }),
      seasonEpisodes(ref.id, season),
      episodeAfter(ref.id, season, number),
      episodeBefore(ref.id, season, number),
      seriesProgress(userId, ref.id),
    ]);
    series = artwork;
    const idOf = (s: number, e: number) => titleId({ type: "tv", id: ref.id, season: s, episode: e });
    if (before) previous = idOf(before.season, before.episode.number);
    if (next && hasAired(next.episode)) {
      const id = idOf(next.season, next.episode.number);
      upNext = {
        kind: "episode",
        fileId: id,
        title: next.episode.name,
        subtitle: [next.newSeason ? "New season" : null, `S${next.season} E${next.episode.number}`, artwork?.title].filter(Boolean).join(" · "),
        imagePath: `/api/thumbnail/${encodeURIComponent(id)}`,
        overview: next.episode.overview,
        infoHref: null,
      };
    }
    const aired = list.filter(hasAired);
    episodes = aired.map((e) => ({ kind: "video", id: idOf(season, e.number), name: e.name, mimeType: "video/stream", episodeNumber: e.number }));
    progressByFileId = Object.fromEntries(
      aired.flatMap((e) => {
        const p = progress.get(spot(season, e.number));
        return p ? [[idOf(season, e.number), { positionSeconds: p.positionSeconds, durationSeconds: p.durationSeconds, completed: p.completed }]] : [];
      }),
    );
  }

  return {
    fileId: video._id,
    ...titleMeta(video.artwork, "video", video._id),
    title: video.title,
    tmdb: ref,
    episode: episodeMeta(video.episodeArtwork),
    /** The series' own name, for a page that has no series page behind it. */
    seriesTitle: series?.title ?? null,
    upNext,
    suggestions: [],
    backHref: `/?title=${ref.type}-${ref.id}`,
    parentFolderId: video.parentFolderId,
    nextFileId: upNext?.fileId ?? null,
    previousFileId: previous,
    episodes,
    progressByFileId,
    initialPositionSeconds: own?.positionSeconds ?? 0,
    initialCompleted: own?.completed ?? false,
    initialSubtitleSource: own?.subtitleSource ?? null,
    initialSubtitleIndex: own?.subtitleIndex ?? null,
    initialSubtitleLanguage: own?.subtitleLanguage ?? null,
    initialSubtitleTitle: own?.subtitleTitle ?? null,
    initialAudioLanguage: own?.audioLanguage ?? null,
    initialAudioTitle: own?.audioTitle ?? null,
    seekMode: "native" as const,
    durationSeconds: null,
    subtitles: [],
    audioTracks: null,
    subtitleTracks: null,
    startAudio: null,
    startSubtitle: null,
    languages: null,
    introStart: null,
    introEnd: null,
    outroStart: null,
    players,
    sources,
    embeds: [],
  };
}

/** The card a title gets in Continue watching. */
export async function titleCard(id: string) {
  const video = await getVideoOrTitle(id);
  if (!video) return null;
  const ref = parseTitleId(id)!;
  const series = ref.type === "tv" ? (await artworkOf({ type: "tv", id: ref.id }))?.title : null;
  const name = series ? `${series} · S${ref.season} E${ref.episode}` : (video.title ?? video.driveName);
  return { kind: "video" as const, id, name, mimeType: video.mimeType };
}

export const titleKeyOfId = (id: string) => {
  const ref = parseTitleId(id);
  return ref ? tmdbKey({ type: ref.type, id: ref.id }) : null;
};
