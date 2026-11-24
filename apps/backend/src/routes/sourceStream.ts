import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { playableVideo } from "../lib/titlePlay";
import { HostError } from "../lib/videoHosts";
import { streamFor } from "../lib/videoSources";

/**
 * GET /api/source-stream/:sourceId/:fileId (a title's own id too) → { url, captions } — the HLS address a title plays from
 * in one source, good for twelve hours. 404 when the source doesn't have it, which is a player's cue
 * to try the next one.
 */
const router = Router();

router.get("/:sourceId/:fileId", requireAuth, async (req, res) => {
  try {
    // The same rule as /api/video: what isn't published is for the admin only.
    const video = await playableVideo(req.params.fileId, req.authUser!.email);
    const stream = video ? await streamFor(req.params.sourceId, video) : null;
    if (!stream) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.setHeader("cache-control", "no-store");
    res.json(stream);
  } catch (error) {
    console.error(`[sources] ${req.params.sourceId}:`, error instanceof HostError ? error.message : error);
    res.status(502).json({ error: "That source isn't answering" });
  }
});

export default router;
