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
import { getProgress, getProgressForFolder, getMostRecentPreferenceForFolder, getRecentInProgress } from "../lib/progress";
import { listSubtitleSetsByIds } from "../lib/subtitleSets";
import { naturalSort, orderEpisodes, type CatalogListItem } from "../lib/catalogListItem";
import { listRecentlyFulfilled } from "../lib/mediaRequests";

const router = Router();

/** A single slide in the Home spotlight carousel. `kind` is what the eyebrow says, not what the
 * item is: "new" and "featured" are library picks, "request" is a title somebody asked for that
 * has since been published. */
type SpotlightSlide = {
  id: string;
  kind: "new" | "featured" | "request";
  title: string;
  badge: string;
  playHref: string;
  infoHref: string | null;
  thumbnailPath: string | null;
  /** Request slides only. */
  requestId?: string;
  requestedByName?: string | null;
  /** True when the viewer is the requester or one of the people who upvoted it — the client
   * swaps the eyebrow to "You asked for this". */
  youAsked?: boolean;
};

type SpotlightSource = { kind: "folder" | "video"; id: string; name: string; thumbnailFileId?: string | null };

/** Resolves an item to the hrefs/thumbnail a slide needs. A folder plays its first episode, which
 * is why this is async — same rule the single hero has always used. */
async function toSlideTargets(item: SpotlightSource): Promise<Pick<SpotlightSlide, "playHref" | "infoHref" | "thumbnailPath">> {
  if (item.kind === "video") {
    return {
      playHref: `/watch/${item.id}`,
      infoHref: null,
      thumbnailPath: `/api/thumbnail/${item.id}`,
    };
  }

  const episodes = orderEpisodes(
    (await listPublishedVideosByParent(item.id)).map((v) => ({
      id: v._id,
      name: v.title!,
      episodeOrder: v.episodeOrder,
    })),
  );
  return {
    playHref: episodes[0] ? `/watch/${episodes[0].id}` : `/folder/${item.id}`,
    infoHref: `/folder/${item.id}`,
    thumbnailPath: item.thumbnailFileId ? `/api/thumbnail-folder/${item.id}` : null,
  };
}

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const FULFILLED_SLIDE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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
    res.json({ empty: true, folders: [], videos: [], spotlight: [], hero: null, continueWatching: [] });
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
  const heroTargets = await toSlideTargets(hero as SpotlightSource);

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

  // --- Spotlight carousel -------------------------------------------------------------------
  // Library picks first (most recently curated), then any request that has since been published,
  // interleaved so a fulfilled request lands in slide 2 rather than at the end where nobody
  // scrolls to it. The single `hero` field below is still sent for older app builds that predate
  // the carousel; it's always spotlight[0].
  const itemsByRecency = [...items].sort((a, b) => {
    const at = a.curatedAt ? new Date(a.curatedAt).getTime() : 0;
    const bt = b.curatedAt ? new Date(b.curatedAt).getTime() : 0;
    return bt - at;
  });

  const now = Date.now();
  const librarySlides: SpotlightSlide[] = await Promise.all(
    itemsByRecency.slice(0, 5).map(async (item, index) => {
      const curatedMs = item.curatedAt ? new Date(item.curatedAt).getTime() : 0;
      const isFresh = curatedMs > 0 && now - curatedMs < ONE_WEEK_MS;
      return {
        id: item.id,
        // Past the freshly-added ones this is simply the library's own shelf of good picks —
        // calling that "featured" is honest, calling it "new" would not be.
        kind: isFresh ? ("new" as const) : ("featured" as const),
        title: item.name,
        badge: isFresh ? "New this week" : index === 0 ? "Recently added" : "Featured",
        ...(await toSlideTargets(item as SpotlightSource)),
      };
    }),
  );

  const fulfilled = await listRecentlyFulfilled(4);
  const viewerId = req.authUser!.userId;
  const requestSlides: SpotlightSlide[] = (
    await Promise.all<SpotlightSlide | null>(
      fulfilled.map(async (request) => {
        if (!request.catalogRef) return null;
        if (now - new Date(request.statusChangedAt).getTime() > FULFILLED_SLIDE_MAX_AGE_MS) return null;

        // The linked item has to still be published — an unpublished or deleted target would be a
        // slide whose Play button goes nowhere.
        const target =
          request.catalogRef.kind === "video"
            ? await getCatalogVideo(request.catalogRef.id)
            : await getCatalogFolder(request.catalogRef.id);
        if (!target || target.status !== "published") return null;

        const youAsked = request.upvotes.includes(viewerId);
        const source: SpotlightSource = {
          kind: request.catalogRef.kind,
          id: request.catalogRef.id,
          name: target.title ?? request.title,
          thumbnailFileId: "thumbnailFileId" in target ? target.thumbnailFileId : null,
        };
        return {
          id: request.catalogRef.id,
          kind: "request" as const,
          title: target.title ?? request.title,
          badge: youAsked
            ? "You asked for this"
            : `Requested by ${request.requestedByName ?? "someone"} · Now available`,
          requestId: request._id,
          requestedByName: request.requestedByName,
          youAsked,
          ...(await toSlideTargets(source)),
        };
      }),
    )
  ).filter((slide): slide is SpotlightSlide => slide !== null);

  const spotlight: SpotlightSlide[] = [];
  const library = [...librarySlides];
  const requested = [...requestSlides];
  // Slide 1 is always a library pick; after that, alternate so fulfilled requests are impossible
  // to miss without ever filling the whole carousel with them.
  if (library.length > 0) spotlight.push(library.shift()!);
  while ((library.length > 0 || requested.length > 0) && spotlight.length < 6) {
    if (requested.length > 0) spotlight.push(requested.shift()!);
    if (library.length > 0 && spotlight.length < 6) spotlight.push(library.shift()!);
  }

  res.json({
    empty: false,
    spotlight,
    // Deprecated in favour of `spotlight` — kept so an older installed Android/Windows build keeps
    // rendering its single hero against a newer backend. Remove once those are gone.
    hero: {
      title: hero.name,
      badge: spotlight[0]?.badge ?? "Recently Added",
      playHref: heroTargets.playHref,
      infoHref: heroTargets.infoHref,
      thumbnailPath: heroTargets.thumbnailPath,
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
  // "Watch a series, the audio/subtitle pick follows every episode" — if this exact video has
  // never had a preference saved on it, fall back to whatever was most recently picked elsewhere
  // in the same series, rather than always landing on defaults for every new episode. An explicit
  // preference on this video's own progress doc always wins once it exists (e.g. the user picked
  // something different for this one episode specifically). subtitleIndex is only trusted from the
  // video's own doc — a raw index only means something within a single video's own subtitle/probe
  // list, so a fallback from a sibling episode carries language/title only, and the client
  // resolves that by name against this video's own track list (falling back to no subtitle / the
  // default track when the name isn't found there).
  let preference = progress;
  let preferenceIsOwnVideo = true;
  if (!isStandalone && !progress?.subtitleSource && !progress?.audioLanguage) {
    const fallback = await getMostRecentPreferenceForFolder(req.authUser!.userId, parentFolderId, fileId);
    if (fallback) {
      preference = fallback;
      preferenceIsOwnVideo = false;
    }
  }
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
    // Remembered track choices (see lib/progress.ts) — undefined/absent collapses to null here,
    // meaning "no preference, use default behavior". May come from this video's own progress doc,
    // or (see `preference` above) a series-wide fallback from a sibling episode.
    initialSubtitleSource: preference?.subtitleSource ?? null,
    initialSubtitleIndex: preferenceIsOwnVideo ? (preference?.subtitleIndex ?? null) : null,
    initialSubtitleLanguage: preference?.subtitleLanguage ?? null,
    initialSubtitleTitle: preference?.subtitleTitle ?? null,
    initialAudioLanguage: preference?.audioLanguage ?? null,
    initialAudioTitle: preference?.audioTitle ?? null,
    seekMode,
    durationSeconds: video.durationSeconds,
    subtitles,
    introStart: video.introStart,
    introEnd: video.introEnd,
    outroStart: video.outroStart,
  });
});

export default router;
