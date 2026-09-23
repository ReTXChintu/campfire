import express, { Router } from "express";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../../config/env";
import { requireAdmin } from "../../middleware/auth";
import {
  getCatalogVideo,
  curateVideo,
  publishVideo,
  unpublishVideo,
  addSubtitleSetId,
  queueRenditions,
  resetVideoOverride,
  deleteVideosByIds,
} from "../../lib/catalogVideos";
import { getCatalogFolder } from "../../lib/catalogFolders";
import {
  getSubtitleSet,
  linkSubtitleSet,
  unlinkSubtitleSet,
  listUnlinkedSubtitleSets,
  listSubtitleSetsByIds,
  createAndLinkSubtitleSet,
  deleteSubtitleSetsForVideo,
} from "../../lib/subtitleSets";
import { deleteProgressForFile } from "../../lib/progress";
import { endWatchPartiesForFile } from "../../lib/watchParties";
import { convertSrtTextToVtt, probeStreams, trashDriveFile } from "../../lib/drive";
import { storableTiersFor } from "../../lib/qualityLadder";

const router = Router();

router.get("/:fileId", requireAdmin, async (req, res) => {
  const { fileId } = req.params;
  const video = await getCatalogVideo(fileId);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  const [parentFolder, unlinkedSets, linkedSets] = await Promise.all([
    getCatalogFolder(video.parentFolderId),
    listUnlinkedSubtitleSets(),
    listSubtitleSetsByIds(video.subtitleSetIds ?? []),
  ]);

  const subtitleSetOptions = [...unlinkedSets, ...linkedSets].map((set) => ({
    id: set._id.toString(),
    sourceLabel: set.sourceLabel,
    createdAt: set.createdAt.toISOString(),
    tracks: set.subtitles.map((s) => ({ index: s.index, language: s.language, title: s.title })),
  }));

  res.json({ video, parentFolder, subtitleSetOptions });
});

router.patch("/:fileId", requireAdmin, async (req, res) => {
  const { fileId } = req.params;
  const video = await getCatalogVideo(fileId);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  const { title, subtitleSetIds, introStart, introEnd, outroStart } = req.body as {
    title?: string;
    subtitleSetIds?: string[];
    introStart?: number | null;
    introEnd?: number | null;
    outroStart?: number | null;
  };

  const trimmedTitle = title?.trim();
  if (!trimmedTitle) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  if (introStart != null && introEnd != null && introStart >= introEnd) {
    res.status(400).json({ error: "introStart must be before introEnd" });
    return;
  }

  const requestedIds = [...new Set(subtitleSetIds ?? [])];
  for (const id of requestedIds) {
    const set = await getSubtitleSet(id).catch(() => null);
    if (!set) {
      res.status(400).json({ error: "Subtitle set not found" });
      return;
    }
    if (set.linkedVideoId && set.linkedVideoId !== fileId) {
      res.status(400).json({ error: "Subtitle set is already linked to a different video" });
      return;
    }
  }

  // Free up any previously-linked sets that were deselected, so they return to the picker pool.
  const previousIds = video.subtitleSetIds ?? [];
  await Promise.all(
    previousIds.filter((id) => !requestedIds.includes(id)).map((id) => unlinkSubtitleSet(id)),
  );
  await Promise.all(
    requestedIds.filter((id) => !previousIds.includes(id)).map((id) => linkSubtitleSet(id, fileId)),
  );

  await curateVideo(fileId, {
    title: trimmedTitle,
    subtitleSetIds: requestedIds,
    introStart: introStart ?? null,
    introEnd: introEnd ?? null,
    outroStart: outroStart ?? null,
    curatedBy: req.authUser!.email,
  });

  res.json({ ok: true });
});

router.post("/:fileId/publish", requireAdmin, async (req, res) => {
  const { fileId } = req.params;
  const { matched } = await publishVideo(fileId);
  if (!matched) {
    res.status(400).json({ error: "Video must be curated (title set) before it can be published" });
    return;
  }
  res.json({ ok: true });
});

// Clears an admin's earlier manual edit so the parent folder's publish-rule can drive this field
// again on its next apply (the value itself doesn't change until that next apply runs).
router.post("/:fileId/reset-override", requireAdmin, async (req, res) => {
  const { fileId } = req.params;
  const { field } = req.body as { field?: "title" | "intro" };
  if (field !== "title" && field !== "intro") {
    res.status(400).json({ error: "field must be 'title' or 'intro'" });
    return;
  }
  const video = await getCatalogVideo(fileId);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  await resetVideoOverride(fileId, field);
  res.json({ ok: true });
});

router.post("/:fileId/unpublish", requireAdmin, async (req, res) => {
  const { fileId } = req.params;
  const { matched } = await unpublishVideo(fileId);
  if (!matched) {
    res.status(400).json({ error: "Video is not currently published" });
    return;
  }
  res.json({ ok: true });
});

// Queues generation for every tier this video's resolution can support that isn't already "done"
// (re-queues "failed" ones too — a retry) — 480p/720p/1080p is a fixed, non-negotiable policy (see
// lib/qualityLadder.ts), so there's no per-tier picker on the admin side, just one button.
router.post("/:fileId/renditions", requireAdmin, async (req, res) => {
  const { fileId } = req.params;
  const video = await getCatalogVideo(fileId);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  const probe = await probeStreams(fileId).catch(() => null);
  const sourceHeight = probe?.videoTrack?.height ?? null;
  const tiers = storableTiersFor(sourceHeight);
  const toQueue = tiers.filter((t) => video.renditions?.[String(t.height)]?.status !== "done").map((t) => t.height);

  if (toQueue.length === 0) {
    res.status(400).json({
      error:
        tiers.length === 0
          ? "This video's resolution is too low for any stored quality tier below Original."
          : "All available quality tiers are already generated.",
    });
    return;
  }

  await queueRenditions(fileId, toQueue);
  res.json({ queued: toQueue });
});

// Removes a video everywhere: the Drive file itself (trashed, not permanently deleted — see
// trashDriveFile), its subtitle sets, every user's progress on it, its on-disk renditions, any open
// watch party on it, and finally the catalog doc. Drive goes first on purpose: if trashing fails
// (the service account lacks Editor access on the library folder), nothing else is touched —
// otherwise the next scan would just re-import the still-present Drive file as a fresh "pending"
// video, silently undoing the delete.
router.delete("/:fileId", requireAdmin, async (req, res) => {
  const { fileId } = req.params;
  const video = await getCatalogVideo(fileId);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  try {
    await trashDriveFile(fileId);
  } catch (error) {
    console.error(`Failed to trash Drive file ${fileId}:`, error);
    res.status(502).json({
      error:
        "Couldn't move the file to Drive's trash — check that the service account has Editor access on the library folder. Nothing was deleted.",
    });
    return;
  }

  await Promise.all([
    endWatchPartiesForFile(fileId),
    deleteSubtitleSetsForVideo(fileId),
    deleteProgressForFile(fileId),
    rm(join(env.renditionsDir, fileId), { recursive: true, force: true }),
  ]);
  await deleteVideosByIds([fileId]);

  res.json({ ok: true, parentFolderId: video.parentFolderId });
});

const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024; // subtitle files are plain text — a few KB to low MB at most

// Uploaded directly on a video's curation page — not tied to a Converter run. Accepts the raw
// subtitle text as the request body (small enough that a plain-text body is simpler than
// multipart), with `label`/`format` as query params.
router.post("/:fileId/subtitles", requireAdmin, express.text({ type: () => true }), async (req, res) => {
  const { fileId } = req.params;
  const video = await getCatalogVideo(fileId);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  const label = typeof req.query.label === "string" ? req.query.label.trim() : "";
  const format = req.query.format;
  if (!label) {
    res.status(400).json({ error: "label is required" });
    return;
  }
  if (format !== "srt" && format !== "vtt") {
    res.status(400).json({ error: "format must be srt or vtt" });
    return;
  }

  const text: string = typeof req.body === "string" ? req.body : "";
  if (!text.trim()) {
    res.status(400).json({ error: "Subtitle file is empty" });
    return;
  }
  if (Buffer.byteLength(text, "utf-8") > MAX_SUBTITLE_BYTES) {
    res.status(400).json({ error: "Subtitle file is too large" });
    return;
  }

  let vtt: string;
  try {
    vtt = format === "srt" ? await convertSrtTextToVtt(text) : text;
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to convert subtitle" });
    return;
  }

  const subtitleSetId = await createAndLinkSubtitleSet({
    sourceLabel: video.title ?? video.driveName,
    label,
    vtt,
    createdBy: req.authUser!.email,
    videoId: fileId,
  });
  await addSubtitleSetId(fileId, subtitleSetId);

  res.json({ subtitleSetId });
});

export default router;
