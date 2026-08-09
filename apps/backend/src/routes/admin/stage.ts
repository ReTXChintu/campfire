import { Router } from "express";
import { createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { requireAdmin } from "../../middleware/auth";
import { probeLocalFile } from "../../lib/drive";
import { stagedFilePath, stagedMetaPath, sweepStaleStagedFiles } from "../../lib/staging";
import { sweepStaleDownloads } from "../../lib/downloads";
import { writeFile } from "node:fs/promises";

const router = Router();

// Stages an uploaded file to local disk (not Drive yet) so we can probe it with ffprobe directly
// — much faster/more reliable than the Drive-URL+bearer-token path, and lets the admin see real
// audio/subtitle track info before committing to a destination or an audio-track choice.
router.post("/", requireAdmin, async (req, res) => {
  // Opportunistic cleanup of anything abandoned from a past session — best-effort, never blocks
  // this upload if it fails for some reason.
  await Promise.all([sweepStaleStagedFiles().catch(() => {}), sweepStaleDownloads().catch(() => {})]);

  const stagingId = randomUUID();
  const filePath = stagedFilePath(stagingId);
  const mimeType = req.headers["content-type"] || "application/octet-stream";

  try {
    await pipeline(req, createWriteStream(filePath));

    const { size } = await stat(filePath);
    await writeFile(stagedMetaPath(stagingId), JSON.stringify({ mimeType, sizeBytes: size }));

    const probe = await probeLocalFile(filePath);

    res.json({ stagingId, sizeBytes: size, probe });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Staging failed" });
  }
});

export default router;
