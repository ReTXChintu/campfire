import { Router } from "express";
import { requireAdmin } from "../../middleware/auth";
import { getJob } from "../../lib/uploadJobs";
import { getSubtitleSet } from "../../lib/subtitleSets";

const router = Router();

router.get("/:jobId", requireAdmin, async (req, res) => {
  const { jobId } = req.params;
  const job = await getJob(jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  // Lightweight track list only (no `vtt` payload) — this route is polled every 2s, keep it small.
  const subtitleSet = job.subtitleSetId ? await getSubtitleSet(job.subtitleSetId) : null;

  res.json({
    status: job.status,
    downloadId: job.downloadId ?? null,
    filename: job.filename ?? null,
    subtitleSetId: job.subtitleSetId ?? null,
    subtitleTracks:
      subtitleSet?.subtitles.map((s) => ({ index: s.index, language: s.language, title: s.title })) ?? [],
    error: job.error ?? null,
  });
});

export default router;
