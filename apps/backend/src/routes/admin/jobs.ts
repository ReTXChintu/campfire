import { Router } from "express";
import { requireAdmin } from "../../middleware/auth";
import { getJob, getJobsByBatch, type UploadJobDoc } from "../../lib/uploadJobs";
import { getSubtitleSet } from "../../lib/subtitleSets";

const router = Router();

// Lightweight track list only (no `vtt` payload) — these routes are polled every 2s, keep them
// small.
async function toStatus(job: UploadJobDoc) {
  const subtitleSet = job.subtitleSetId ? await getSubtitleSet(job.subtitleSetId) : null;
  return {
    jobId: job.jobId,
    status: job.status,
    downloadId: job.downloadId ?? null,
    filename: job.filename ?? null,
    subtitleSetId: job.subtitleSetId ?? null,
    subtitleTracks:
      subtitleSet?.subtitles.map((s) => ({ index: s.index, language: s.language, title: s.title })) ?? [],
    error: job.error ?? null,
  };
}

// Polls every job in a "Convert All" batch in one request, instead of one request per file.
router.get("/", requireAdmin, async (req, res) => {
  const { batchId } = req.query as { batchId?: string };
  if (!batchId) {
    res.status(400).json({ error: "batchId is required" });
    return;
  }
  const jobs = await getJobsByBatch(batchId);
  res.json({ jobs: await Promise.all(jobs.map(toStatus)) });
});

router.get("/:jobId", requireAdmin, async (req, res) => {
  const { jobId } = req.params;
  const job = await getJob(jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(await toStatus(job));
});

export default router;
