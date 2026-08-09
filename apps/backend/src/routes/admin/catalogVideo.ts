import express, { Router } from "express";
import { requireAdmin } from "../../middleware/auth";
import { getCatalogVideo, curateVideo, publishVideo, unpublishVideo, addSubtitleSetId } from "../../lib/catalogVideos";
import { getCatalogFolder } from "../../lib/catalogFolders";
import {
  getSubtitleSet,
  linkSubtitleSet,
  unlinkSubtitleSet,
  listUnlinkedSubtitleSets,
  listSubtitleSetsByIds,
  createAndLinkSubtitleSet,
} from "../../lib/subtitleSets";
import { convertSrtTextToVtt } from "../../lib/drive";

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

router.post("/:fileId/unpublish", requireAdmin, async (req, res) => {
  const { fileId } = req.params;
  const { matched } = await unpublishVideo(fileId);
  if (!matched) {
    res.status(400).json({ error: "Video is not currently published" });
    return;
  }
  res.json({ ok: true });
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
