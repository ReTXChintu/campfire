import { Router } from "express";
import { probeStreams } from "../lib/drive";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.get("/:fileId", requireAuth, async (req, res) => {
  const { fileId } = req.params;
  try {
    const probe = await probeStreams(fileId);
    res.setHeader("cache-control", "private, max-age=3600");
    res.json(probe);
  } catch {
    // Degrade gracefully: no track menus rather than a broken player if ffprobe fails.
    res.json({ audioTracks: [], subtitleTracks: [], durationSeconds: null });
  }
});

export default router;
