import { env } from "../config/env";
import { getCatalogFolder, listPublishedFoldersByParent, type CatalogFolder } from "./catalogFolders";
import { listPublishedVideosByParent, type CatalogVideo } from "./catalogVideos";
import { naturalSort, orderEpisodes } from "./catalogListItem";
import { getProgressForFiles } from "./progress";
import { guessSeasonNumber } from "./episodeArtwork";
import { settledTitles } from "./opinions";
import { tmdbKey, tmdbRefOf } from "./tmdbRef";
import type { CatalogArtwork } from "./artwork";

/**
 * What plays after this video: the "Up next" card the players show near the end, which counts
 * down and starts it on its own.
 *
 *  1. The next episode in the same season.
 *  2. Otherwise the first episode of the next season — the end of a season used to just stop.
 *  3. Otherwise (a series finale, or a film) the library's best match for what was just watched,
 *     from TMDb's genres and cast: see `suggestionsFor`.
 *
 * Everything here comes from the library itself; nothing is fetched from TMDb on the way.
 */
export type UpNextItem = {
  kind: "episode" | "suggestion";
  /** The video to play. For a suggested series, its first episode. */
  fileId: string;
  title: string;
  /** "S2 E1 · House of the Dragon", or a suggestion's reason ("With Matt Smith"). */
  subtitle: string | null;
  /** Backend image path: an episode's still, or the suggested title's artwork. */
  imagePath: string;
  overview: string | null;
  /** A suggested series' own page; null for an episode or a film. */
  infoHref: string | null;
};

type Episode = CatalogVideo & { name: string };

async function orderedEpisodes(folderId: string): Promise<Episode[]> {
  const videos = await listPublishedVideosByParent(folderId);
  return orderEpisodes(videos.map((v) => ({ ...v, name: v.title ?? v.driveName })));
}

/** A series' season folders in viewing order: by season number (an admin's, else what the name
 * says), with specials (season 0) and folders no number can be found for after every real season —
 * alphabetically, "Behind the Scenes" and "Specials" would otherwise come before "Season 1" and
 * become where the series starts. */
async function orderedSeasons(seriesId: string): Promise<CatalogFolder[]> {
  const seasons = naturalSort((await listPublishedFoldersByParent(seriesId)).map((s) => ({ ...s, name: s.title ?? s.driveName })));
  const rank = (s: CatalogFolder) => {
    const n = s.tmdbSeason ?? guessSeasonNumber(s.title, s.driveName);
    return n == null ? 1000 : n === 0 ? 999 : n;
  };
  // Stable: equal ranks keep their natural-sort order.
  return seasons.map((s, i) => ({ s, i, r: rank(s) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.s);
}

/** The series a video belongs to — its folder, or that folder's parent for a season folder — or
 * null for a film in the library root. The catalog is at most two levels deep. */
export async function seriesOf(video: CatalogVideo): Promise<CatalogFolder | null> {
  if (video.parentFolderId === env.driveRootFolderId) return null;
  const folder = await getCatalogFolder(video.parentFolderId);
  if (!folder) return null;
  if (folder.parentFolderId === env.driveRootFolderId) return folder;
  return getCatalogFolder(folder.parentFolderId);
}

/** Where a series starts: the first season's first episode, or for a series whose episodes sit
 * straight in its folder, the first of those. */
export async function firstEpisodeOf(seriesId: string): Promise<Episode | null> {
  for (const season of await orderedSeasons(seriesId)) {
    const episodes = await orderedEpisodes(season._id);
    if (episodes.length > 0) return episodes[0];
  }
  return (await orderedEpisodes(seriesId))[0] ?? null;
}

/** The episode after this one, crossing into the next season when this was a season's last. */
export async function nextEpisode(video: CatalogVideo): Promise<{ video: Episode; newSeason: boolean } | null> {
  const siblings = await orderedEpisodes(video.parentFolderId);
  const index = siblings.findIndex((e) => e._id === video._id);
  if (index >= 0 && index + 1 < siblings.length) return { video: siblings[index + 1], newSeason: false };

  const folder = await getCatalogFolder(video.parentFolderId);
  // A film, or an episode straight inside its series folder: nothing after it but a suggestion.
  if (!folder || folder.parentFolderId === env.driveRootFolderId) return null;
  const seasons = await orderedSeasons(folder.parentFolderId);
  const at = seasons.findIndex((s) => s._id === folder._id);
  for (const season of seasons.slice(at + 1)) {
    const episodes = await orderedEpisodes(season._id);
    if (episodes.length > 0) return { video: episodes[0], newSeason: true };
  }
  return null;
}

function episodeLabel(video: CatalogVideo): string | null {
  const ep = video.episodeArtwork;
  if (!ep || !ep.episode || ep.season === 0) return null;
  return `S${ep.season} E${ep.episode}`;
}

export function episodeItem(video: Episode, series: CatalogFolder | null, newSeason: boolean): UpNextItem {
  const label = episodeLabel(video);
  const seriesTitle = series?.title ?? null;
  return {
    kind: "episode",
    fileId: video._id,
    title: video.title ?? video.driveName,
    subtitle:
      [newSeason ? (label ? `New season · ${label}` : "New season") : label, seriesTitle].filter(Boolean).join(" · ") || null,
    imagePath: `/api/thumbnail/${video._id}`,
    overview: video.episodeArtwork?.overview ?? null,
    infoHref: null,
  };
}

type Candidate = { kind: "folder" | "video"; id: string; title: string; artwork: CatalogArtwork | null | undefined; at: number };

/**
 * The library's best matches for what was just watched. A title scores for every genre it shares
 * (3 each) and every lead actor it shares (2 each), with TMDb's score breaking ties, so "more like
 * this" really is like this. Titles the viewer has watched, liked or disliked are left out; so is
 * the title itself. With nothing to compare against (an unmatched title), it falls back to the best-rated,
 * then the most recently added.
 */
export async function suggestionsFor(userId: string, video: CatalogVideo, limit = 6): Promise<UpNextItem[]> {
  const series = await seriesOf(video);
  const source = series ? series.artwork : video.artwork;
  const sourceTitle = series ? (series.title ?? series.driveName) : (video.title ?? video.driveName);
  const genres = new Set(source?.genres ?? []);
  const cast = new Set((source?.cast ?? []).slice(0, 8).map((c) => c.name));

  const [folders, films, settled] = await Promise.all([
    listPublishedFoldersByParent(env.driveRootFolderId),
    listPublishedVideosByParent(env.driveRootFolderId),
    settledTitles(userId),
  ]);
  const isSettled = (doc: Pick<CatalogVideo, "artwork">) => {
    const ref = tmdbRefOf(doc);
    return !!ref && settled.has(tmdbKey(ref));
  };
  const finished = new Set(
    (await getProgressForFiles(userId, films.map((f) => f._id))).filter((p) => p.completed).map((p) => p.fileId),
  );
  const candidates: Candidate[] = [
    ...folders
      .filter((f) => f._id !== series?._id && !isSettled(f))
      .map((f) => ({ kind: "folder" as const, id: f._id, title: f.title ?? f.driveName, artwork: f.artwork, at: f.curatedAt?.getTime?.() ?? 0 })),
    ...films
      .filter((f) => f._id !== video._id && !finished.has(f._id) && !isSettled(f))
      .map((f) => ({ kind: "video" as const, id: f._id, title: f.title ?? f.driveName, artwork: f.artwork, at: f.curatedAt?.getTime?.() ?? 0 })),
  ];

  const scored = candidates.map((c) => {
    const sharedGenres = (c.artwork?.genres ?? []).filter((g) => genres.has(g));
    const sharedCast = (c.artwork?.cast ?? []).slice(0, 8).map((m) => m.name).filter((n) => cast.has(n));
    const rating = c.artwork?.rating?.average ?? 0;
    const score = sharedGenres.length * 3 + sharedCast.length * 2 + rating / 10;
    const reason = sharedCast[0]
      ? `With ${sharedCast[0]}`
      : sharedGenres[0]
        ? `Because you watched ${sourceTitle} · ${sharedGenres[0]}`
        : null;
    return { c, score, reason };
  });
  scored.sort((a, b) => b.score - a.score || b.c.at - a.c.at);

  const out: UpNextItem[] = [];
  for (const { c, reason } of scored) {
    if (out.length >= limit) break;
    if (c.kind === "video") {
      out.push({
        kind: "suggestion",
        fileId: c.id,
        title: c.title,
        subtitle: reason,
        imagePath: `/api/thumbnail/${c.id}`,
        overview: c.artwork?.overview ?? null,
        infoHref: null,
      });
      continue;
    }
    // A series plays from its first episode; one with nothing published yet isn't offered.
    const first = await firstEpisodeOf(c.id);
    if (!first) continue;
    out.push({
      kind: "suggestion",
      fileId: first._id,
      title: c.title,
      subtitle: reason,
      imagePath: `/api/thumbnail-folder/${c.id}`,
      overview: c.artwork?.overview ?? null,
      infoHref: `/folder/${c.id}`,
    });
  }
  return out;
}
