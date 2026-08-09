import { Router } from "express";
import { randomUUID } from "node:crypto";
import { requireAdmin } from "../../middleware/auth";
import { convertLocalFileToMp4 } from "../../lib/drive";
import { createJob, completeJob, failJob } from "../../lib/uploadJobs";
import { stagedFilePath, deleteStagedFile } from "../../lib/staging";
import { moveToDownload } from "../../lib/downloads";
import { createSubtitleSet } from "../../lib/subtitleSets";

const router = Router();

// Converts a locally-staged file (see /api/admin/stage) to a browser-native MP4 entirely on this
// machine — no Drive involved at all. The admin downloads the result and uploads it to Drive by
// hand; this endpoint never writes to Drive (that path is what hit "Service Accounts do not have
// storage quota" — service accounts have no storage of their own outside a shared drive).
router.post("/", requireAdmin, async (req, res) => {
  const { stagingId, title, audioIndex } = req.body as {
    stagingId?: string;
    title?: string;
    audioIndex?: number;
  };
  if (!stagingId || !title || audioIndex == null) {
    res.status(400).json({ error: "stagingId, title, and audioIndex are required" });
    return;
  }

  const jobId = randomUUID();
  const requestedBy = req.authUser!.email;
  await createJob(jobId, requestedBy);

  // No Next.js after() equivalent needed here — this is an always-on process, not a serverless
  // function that freezes after the response. A plain un-awaited async call is enough, with an
  // explicit .catch() since an unhandled rejection in a long-lived process is a real crash risk.
  (async () => {
    const localPath = stagedFilePath(stagingId);
    try {
      const result = await convertLocalFileToMp4(localPath, audioIndex);
      const downloadId = randomUUID();
      await moveToDownload(result.tempFilePath, downloadId);

      const subtitleSetId =
        result.subtitles.length > 0
          ? await createSubtitleSet({
              sourceLabel: title,
              subtitles: result.subtitles,
              jobId,
              createdBy: requestedBy,
            })
          : null;

      await completeJob(jobId, downloadId, `${title}.mp4`, subtitleSetId);
    } catch (error) {
      console.error(`[convert] job ${jobId} failed:`, error);
      await failJob(jobId, error instanceof Error ? error.message : "Conversion failed").catch(() => {});
    } finally {
      await deleteStagedFile(stagingId);
    }
  })().catch((error) => console.error(`[convert] job ${jobId} unhandled error:`, error));

  res.json({ jobId });
});

export default router;
