import { Router } from "express";
import { env } from "../config/env";
import { requireAuth } from "../middleware/auth";
import { isAdminEmail } from "../lib/admin";
import { isNativelyPlayable, isMkv, type ConvertedSubtitle } from "../lib/drive";
import {
  getCatalogFolder,
  listPublishedFoldersByParent,
} from "../lib/catalogFolders";
import {
  getCatalogVideo,
  listPublishedVideosByParent,
} from "../lib/catalogVideos";
import { getProgress, getProgressForFolder, getRecentInProgress } from "../lib/progress";
import { listSubtitleSetsByIds } from "../lib/subtitleSets";
import { naturalSort, orderEpisodes, type CatalogListItem } from "../lib/catalogListItem";

const router = Router();

router.get("/library", requireAuth, async (req, res) => {
  const [folderDocs, videoDocs] = await Promise.all([
    listPublishedFoldersByParent(env.driveRootFolderId),
    listPublishedVideosByParent(env.driveRootFolderId),
  ]);

  const folders = naturalSort(
    folderDocs.map((f) => ({
      kind: "folder" as const,
      id: f._id,
      name: f.title!,
      thumbnailFileId: f.thumbnailFileId,
    })),
  );
  const videos = naturalSort(
    videoDocs.map((v) => ({ kind: "video" as const, id: v._id, name: v.title!, mimeType: v.mimeType })),
  );
  const items: (CatalogListItem & { curatedAt: Date | null })[] = [
    ...folderDocs.map((f) => ({
      kind: "folder" as const,
      id: f._id,
      name: f.title!,
      thumbnailFileId: f.thumbnailFileId,
      curatedAt: f.curatedAt,
    })),
    ...videoDocs.map((v) => ({
      kind: "video" as const,
      id: v._id,
      name: v.title!,
      mimeType: v.mimeType,
      curatedAt: v.curatedAt,
    })),
  ];

  if (items.length === 0) {
    res.json({ empty: true, folders: [], videos: [], hero: null, continueWatching: [] });
    return;
  }

  // Real "most recently curated" pick, not a fabricated hero slot.
  const hero = [...items].sort((a, b) => {
    const at = a.curatedAt ? new Date(a.curatedAt).getTime() : 0;
    const bt = b.curatedAt ? new Date(b.curatedAt).getTime() : 0;
    return bt - at;
  })[0];

  // A ready-to-use path (or null, when a folder simply has no thumbnail yet) rather than a raw id
  // + kind — keeps clients from needing to know the folder-vs-video branching this backend already
  // knows (matches heroPlayHref/heroInfoHref's own "hand back a usable href" convention).
  const heroThumbnailPath =
    hero.kind === "video" ? `/api/thumbnail/${hero.id}` : hero.thumbnailFileId ? `/api/thumbnail-folder/${hero.id}` : null;
  let heroPlayHref = `/folder/${hero.id}`;
  const heroInfoHref = hero.kind === "folder" ? `/folder/${hero.id}` : undefined;
  if (hero.kind === "video") {
    heroPlayHref = `/watch/${hero.id}`;
  } else {
    const episodesInFolder = orderEpisodes(
      (await listPublishedVideosByParent(hero.id)).map((v) => ({
        id: v._id,
        name: v.title!,
        episodeOrder: v.episodeOrder,
      })),
    );
    heroPlayHref = episodesInFolder[0] ? `/watch/${episodesInFolder[0].id}` : `/folder/${hero.id}`;
  }

  const continueWatching = await getRecentInProgress(req.authUser!.userId, 12);
  const continueWatchingItems = (
    await Promise.all(
      continueWatching.map(async (progress) => {
        const video = await getCatalogVideo(progress.fileId);
        if (!video || video.status !== "published") return null; // unpublished or deleted — skip rather than break the row
        return {
          item: { kind: "video" as const, id: video._id, name: video.title!, mimeType: video.mimeType },
          progress,
        };
      }),
    )
  ).filter((v): v is NonNullable<typeof v> => v !== null);

  res.json({
    empty: false,
    hero: {
      title: hero.name,
      badge: "Recently Added",
      playHref: heroPlayHref,
      infoHref: heroInfoHref ?? null,
      thumbnailPath: heroThumbnailPath,
    },
    continueWatching: continueWatchingItems,
    folders,
    videos,
  });
});

router.get("/folder/:folderId", requireAuth, async (req, res) => {
  const { folderId } = req.params;
  const folder = await getCatalogFolder(folderId);
  if (!folder || folder.status !== "published") {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const backHref =
    folder.parentFolderId === env.driveRootFolderId ? "/" : `/folder/${folder.parentFolderId}`;

  // Case 1: no subfolders — just a flat grid of whatever videos/folders sit directly inside.
  const childFolderDocs = await listPublishedFoldersByParent(folderId);
  if (childFolderDocs.length === 0) {
    const [videoDocs, progressList] = await Promise.all([
      listPublishedVideosByParent(folderId),
      getProgressForFolder(req.authUser!.userId, folderId),
    ]);
    const items = naturalSort([
      ...childFolderDocs.map((f) => ({
        kind: "folder" as const,
        id: f._id,
        name: f.title!,
        thumbnailFileId: f.thumbnailFileId,
      })),
      ...videoDocs.map((v) => ({ kind: "video" as const, id: v._id, name: v.title!, mimeType: v.mimeType })),
    ]);
    res.json({
      mode: "flat",
      folderId,
      title: folder.title,
      backHref,
      thumbnailFileId: folder.thumbnailFileId,
      items,
      progress: progressList,
    });
    return;
  }

  // Case 2: subfolders are seasons — thumbnail, season dropdown, that season's videos, and any
  // videos sitting directly in the series folder itself shown separately as "Specials" (they don't
  // change when the season switches).
  const seasons = naturalSort(childFolderDocs.map((f) => ({ id: f._id, name: f.title! })));
  const requestedSeasonId = typeof req.query.season === "string" ? req.query.season : undefined;
  const selectedSeasonId =
    requestedSeasonId && seasons.some((s) => s.id === requestedSeasonId)
      ? requestedSeasonId
      : seasons[0].id;

  const [seasonVideoDocs, specialVideoDocs, progressList] = await Promise.all([
    listPublishedVideosByParent(selectedSeasonId),
    listPublishedVideosByParent(folderId),
    getProgressForFolder(req.authUser!.userId, folderId),
  ]);

  const seasonItems = orderEpisodes(
    seasonVideoDocs.map((v) => ({
      kind: "video" as const,
      id: v._id,
      name: v.title!,
      mimeType: v.mimeType,
      episodeOrder: v.episodeOrder,
    })),
  );
  const specialItems = orderEpisodes(
    specialVideoDocs.map((v) => ({
      kind: "video" as const,
      id: v._id,
      name: v.title!,
      mimeType: v.mimeType,
      episodeOrder: v.episodeOrder,
    })),
  );

  res.json({
    mode: "series",
    folderId,
    title: folder.title,
    backHref,
    thumbnailFileId: folder.thumbnailFileId,
    seasons,
    selectedSeasonId,
    seasonItems,
    specialItems,
    progress: progressList,
  });
});

router.get("/video/:fileId", requireAuth, async (req, res) => {
  const { fileId } = req.params;
  const video = await getCatalogVideo(fileId);

  // "pending" (no title yet) is never watchable — preview happens on the curation page instead.
  // "curated" (title set, not yet published) is admin-only, so you can check timing/subtitles
  // before making it visible. "published" is open to any signed-in viewer.
  const isAdmin = isAdminEmail(req.authUser!.email);
  if (!video || video.status === "pending" || (video.status === "curated" && !isAdmin)) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const parentFolderId = video.parentFolderId;
  const isStandalone = parentFolderId === env.driveRootFolderId;

  let nextFileId: string | null = null;
  let previousFileId: string | null = null;
  let episodes: { id: string; name: string }[] = [];
  let progressByFileId: Record<string, { positionSeconds: number; completed: boolean }> = {};

  if (!isStandalone) {
    const [episodeDocs, progressList] = await Promise.all([
      listPublishedVideosByParent(parentFolderId),
      getProgressForFolder(req.authUser!.userId, parentFolderId),
    ]);
    const episodeList = orderEpisodes(
      episodeDocs.map((e) => ({ id: e._id, name: e.title!, episodeOrder: e.episodeOrder })),
    );
    const index = episodeList.findIndex((e) => e.id === fileId);
    nextFileId = index >= 0 ? (episodeList[index + 1]?.id ?? null) : null;
    previousFileId = index >= 0 ? (episodeList[index - 1]?.id ?? null) : null;
    episodes = episodeList;
    progressByFileId = Object.fromEntries(
      progressList.map((p) => [p.fileId, { positionSeconds: p.positionSeconds, completed: p.completed }]),
    );
  }

  const progress = await getProgress(req.authUser!.userId, fileId);
  const backHref = isStandalone ? "/" : `/folder/${parentFolderId}`;
  // "native": browser <video> plays it directly. "raw": MKV — not web-playable at all, only the
  // desktop/mobile app's native player handles it (see isMkv in lib/drive.ts and the `raw` query
  // param on routes/stream.ts). "restart": anything else, remuxed live on every seek.
  const seekMode = isNativelyPlayable(video.mimeType) ? "native" : isMkv(video.mimeType) ? "raw" : "restart";

  const subtitleSets = await listSubtitleSetsByIds(video.subtitleSetIds ?? []);
  // Re-index sequentially — track `index` is only meaningful within the source it came from, and
  // multiple merged sets could otherwise collide (used as the player's <track> key).
  const subtitles: ConvertedSubtitle[] = subtitleSets
    .flatMap((s) => s.subtitles)
    .map((s, i) => ({ ...s, index: i }));

  res.json({
    fileId,
    title: video.title,
    backHref,
    parentFolderId,
    nextFileId,
    previousFileId,
    episodes,
    progressByFileId,
    initialPositionSeconds: progress?.positionSeconds ?? 0,
    initialCompleted: progress?.completed ?? false,
    // Remembered track choices (see lib/progress.ts) — undefined/absent on `progress` itself
    // (never saved) collapses to null here, meaning "no preference, use default behavior".
    initialSubtitleSource: progress?.subtitleSource ?? null,
    initialSubtitleIndex: progress?.subtitleIndex ?? null,
    initialAudioLanguage: progress?.audioLanguage ?? null,
    initialAudioTitle: progress?.audioTitle ?? null,
    seekMode,
    durationSeconds: video.durationSeconds,
    subtitles,
    introStart: video.introStart,
    introEnd: video.introEnd,
    outroStart: video.outroStart,
  });
});

export default router;
