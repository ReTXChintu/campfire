import { Router } from "express";
import { probeStreams } from "../lib/drive";
import { getCatalogVideo } from "../lib/catalogVideos";
import { storableTiersFor } from "../lib/qualityLadder";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.get("/:fileId", requireAuth, async (req, res) => {
  const { fileId } = req.params;
  try {
    const [probe, video] = await Promise.all([probeStreams(fileId), getCatalogVideo(fileId)]);
    const sourceHeight = probe.videoTrack?.height ?? null;
    // Only tiers that are actually generated and ready — not just theoretically storable for this
    // resolution (see lib/qualityLadder.ts) — since a player must never offer a quality with no
    // file to serve. Renditions are admin-triggered (see routes/admin/catalogVideo.ts), so most
    // videos will report none at all until an admin explicitly generates them.
    const availableQualities = storableTiersFor(sourceHeight).filter(
      (tier) => video?.renditions?.[String(tier.height)]?.status === "done",
    );
    res.setHeader("cache-control", "private, max-age=60");
    res.json({
      ...probe,
      sourceHeight,
      sourceWidth: probe.videoTrack?.width ?? null,
      availableQualities,
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
