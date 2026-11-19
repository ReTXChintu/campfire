import { Router } from "express";
import { getCatalogVideo } from "../lib/catalogVideos";
import { isSafeFileId, readManifest, sheetPath, trickplayFor } from "../lib/trickplay";
import { requireMediaAccess } from "../middleware/mediaAuth";

/**
 * Seek-bar previews (lib/trickplay.ts). Bearer auth, or a media token for this file — the web
 * player draws the sheets as CSS backgrounds, which can't send a header.
 *
 *   GET /api/trickplay/:fileId            → 200 { status: "ready", manifest } — or 202 while it's
 *                                           queued/processing, 404 when it failed or is switched off
 *   GET /api/trickplay/:fileId/sheet/:n   → the n-th sprite sheet (JPEG)
 */
const router = Router();

router.get("/:fileId", requireMediaAccess("fileId"), async (req, res) => {
  const { fileId } = req.params;
  // Only catalog videos: an arbitrary Drive id must never start a download.
  if (!isSafeFileId(fileId) || !(await getCatalogVideo(fileId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const result = await trickplayFor(fileId);
  const code = result.status === "ready" ? 200 : result.status === "queued" || result.status === "processing" ? 202 : 404;
  res.status(code).json(result);
});

router.get("/:fileId/sheet/:index", requireMediaAccess("fileId"), async (req, res) => {
  const { fileId } = req.params;
  const index = Number(req.params.index);
  if (!isSafeFileId(fileId) || !Number.isInteger(index) || index < 0) {
    res.status(404).end();
    return;
  }
  const manifest = await readManifest(fileId);
  if (!manifest || index >= manifest.sheets) {
    res.status(404).end();
    return;
  }
  res.setHeader("cache-control", "private, max-age=604800, immutable");
  res.sendFile(sheetPath(fileId, index), (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

export default router;
