import { Router } from "express";
import { extractSubtitle } from "../lib/drive";
import { requireMediaAccess } from "../middleware/mediaAuth";

const router = Router();

router.get("/:fileId", requireMediaAccess("fileId"), async (req, res) => {
  const { fileId } = req.params;
  const trackIndex = Number(req.query.track);
  if (!Number.isFinite(trackIndex)) {
    res.status(400).json({ error: "track is required" });
    return;
  }

  const tParam = req.query.t;
  const parsed = typeof tParam === "string" ? Number(tParam) : 0;
  const startSeconds = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;

  const abortController = new AbortController();
  req.on("close", () => abortController.abort());

  const vttStream = await extractSubtitle(fileId, trackIndex, startSeconds, abortController.signal);

  res.status(200);
  res.setHeader("content-type", "text/vtt; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  vttStream.pipe(res);
  res.on("close", () => vttStream.destroy());
});

export default router;
