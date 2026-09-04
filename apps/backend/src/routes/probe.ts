import { Router } from "express";
import { probeStreams } from "../lib/drive";
import { availableQualitiesFor } from "../lib/qualityLadder";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.get("/:fileId", requireAuth, async (req, res) => {
  const { fileId } = req.params;
  try {
    const probe = await probeStreams(fileId);
    const sourceHeight = probe.videoTrack?.height ?? null;
    res.setHeader("cache-control", "private, max-age=3600");
    res.json({
      ...probe,
      sourceHeight,
      sourceWidth: probe.videoTrack?.width ?? null,
      availableQualities: availableQualitiesFor(sourceHeight),
    });
  } catch {
    // Degrade gracefully: no track/quality menus rather than a broken player if ffprobe fails.
    res.json({
      audioTracks: [],
      subtitleTracks: [],
      durationSeconds: null,
      sourceHeight: null,
      sourceWidth: null,
      availableQualities: [],
    });
  }
});

export default router;
