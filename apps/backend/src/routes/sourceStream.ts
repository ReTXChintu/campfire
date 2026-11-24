import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { isAdminEmail } from "../lib/admin";
import { getCatalogVideo } from "../lib/catalogVideos";
import { HostError } from "../lib/videoHosts";
import { streamFor } from "../lib/videoSources";

/**
 * GET /api/source-stream/:sourceId/:fileId → { url, captions } — the HLS address a title plays from
 * in one source, good for twelve hours. 404 when the source doesn't have it, which is a player's cue
 * to try the next one.
 */
const router = Router();

router.get("/:sourceId/:fileId", requireAuth, async (req, res) => {
  try {
    const video = await getCatalogVideo(req.params.fileId);
    // The same rule as /api/video: curated-but-unpublished is for the admin only.
    const visible =
      video && (video.status === "published" || (video.status === "curated" && isAdminEmail(req.authUser!.email)));
    const stream = visible ? await streamFor(req.params.sourceId, video) : null;
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
