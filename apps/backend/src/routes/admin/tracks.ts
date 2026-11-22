import { Router } from "express";
import { requireAdmin } from "../../middleware/auth";
import { getDb } from "../../lib/mongodb";
import { getCatalogFolder, type CatalogFolder } from "../../lib/catalogFolders";
import { getCatalogVideo, type CatalogVideo } from "../../lib/catalogVideos";
import {
  ancestorFolders,
  differenceFromSeries,
  effectiveTracks,
  fitNaming,
  folderTree,
  mergeNaming,
  namingForVideo,
  parseNaming,
  pendingTrackReads,
  queueTrackReads,
  readTracks,
  seriesFolderOf,
  stampNaming,
  trackReport,
  type TrackNaming,
} from "../../lib/mediaTracks";

// Audio/subtitle tracks in admin: what each file has, how a series' episodes differ, and the
// names/defaults viewers see — set on a series or season (every episode below it) or one video.
const router = Router();

const empty = (n: TrackNaming | null | undefined): TrackNaming => ({
  audio: n?.audio ?? {},
  subtitles: n?.subtitles ?? {},
  ...(n?.defaultAudio !== undefined ? { defaultAudio: n.defaultAudio } : {}),
  ...(n?.defaultSubtitle !== undefined ? { defaultSubtitle: n.defaultSubtitle } : {}),
});

async function folderPayload(folder: CatalogFolder) {
  const [{ report }, above] = await Promise.all([trackReport(folder._id), ancestorFolders(folder.parentFolderId)]);
  const usual = report.groups.find((g) => g.usual) ?? null;
  // Names from above that fit this folder's usual layout (a season laid out differently from the
  // rest of its series doesn't inherit names meant for other tracks).
  const inherited = mergeNaming(above.map((f) => fitNaming(f.trackNaming, usual)).reverse());
  return {
    folderId: folder._id,
    title: folder.title ?? folder.driveName,
    naming: empty(folder.trackNaming),
    inherited: empty(inherited),
    // The usual layout's tracks, named as viewers will see them — what the naming form edits.
    usual: usual ? { audio: usual.audio, subtitles: usual.subtitles } : null,
    effective: usual ? effectiveTracks(usual, mergeNaming([inherited, fitNaming(folder.trackNaming, usual)])) : null,
    report,
    reading: pendingTrackReads(),
  };
}

async function videoPayload(video: CatalogVideo) {
  const { merged, inherited, folders } = await namingForVideo(video);
  const series = seriesFolderOf(folders);
  const tracks = video.tracks ?? null;
  return {
    fileId: video._id,
    title: video.title ?? video.driveName,
    tracks,
    naming: empty(video.trackNaming),
    inherited: empty(inherited),
    effective: tracks && !tracks.error ? effectiveTracks(tracks, merged) : null,
    series: series ? { id: series._id, title: series.title ?? series.driveName } : null,
    // How this file's tracks differ from most of its series — empty when they don't.
    differences: await differenceFromSeries(video, series),
    reading: pendingTrackReads(),
  };
}

router.get("/folder/:folderId", requireAdmin, async (req, res) => {
  const folder = await getCatalogFolder(req.params.folderId);
  if (!folder) {
    res.status(404).json({ error: "Folder not found" });
    return;
  }
  res.json(await folderPayload(folder));
});

router.put("/folder/:folderId", requireAdmin, async (req, res) => {
  const naming = parseNaming(req.body);
  if (typeof naming === "string") {
    res.status(400).json({ error: naming });
    return;
  }
  // Each name is stamped with the language its position holds in the layout the admin was
  // naming (the usual one), so it's only applied to episodes laid out the same way.
  const { report } = await trackReport(req.params.folderId);
  const usual = report.groups.find((g) => g.usual) ?? null;
  const db = await getDb();
  const result = await db
    .collection<CatalogFolder>("catalogFolders")
    .findOneAndUpdate(
      { _id: req.params.folderId },
      { $set: { trackNaming: stampNaming(naming, usual), updatedAt: new Date() } },
      { returnDocument: "after" },
    );
  if (!result) {
    res.status(404).json({ error: "Folder not found" });
    return;
  }
  res.json(await folderPayload(result));
});

/** Reads every file below the folder again (in the background). */
router.post("/folder/:folderId/read", requireAdmin, async (req, res) => {
  const tree = await folderTree(req.params.folderId);
  if (tree.length === 0) {
    res.status(404).json({ error: "Folder not found" });
    return;
  }
  const db = await getDb();
  const videos = await db
    .collection<CatalogVideo>("catalogVideos")
    .find({ parentFolderId: { $in: tree.map((f) => f._id) } }, { projection: { _id: 1 } })
    .toArray();
  res.json({ queued: queueTrackReads(videos.map((v) => v._id)), reading: pendingTrackReads() });
});

router.get("/video/:fileId", requireAdmin, async (req, res) => {
  const video = await getCatalogVideo(req.params.fileId);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  res.json(await videoPayload(video));
});

router.put("/video/:fileId", requireAdmin, async (req, res) => {
  const naming = parseNaming(req.body);
  if (typeof naming === "string") {
    res.status(400).json({ error: naming });
    return;
  }
  const db = await getDb();
  const result = await db
    .collection<CatalogVideo>("catalogVideos")
    .findOneAndUpdate({ _id: req.params.fileId }, { $set: { trackNaming: naming, updatedAt: new Date() } }, { returnDocument: "after" });
  if (!result) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  res.json(await videoPayload(result));
});

/** Reads this one file now and answers with the result. */
router.post("/video/:fileId/read", requireAdmin, async (req, res) => {
  const video = await getCatalogVideo(req.params.fileId);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  await readTracks(video._id);
  res.json(await videoPayload((await getCatalogVideo(video._id))!));
});

export default router;
