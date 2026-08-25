import { randomUUID } from "node:crypto";
import { convertLocalFileToMp4 } from "./drive";
import { stagedFilePath, deleteStagedFile } from "./staging";
import { moveToDownload } from "./downloads";
import { createSubtitleSet } from "./subtitleSets";
import { claimNextQueuedJob, completeJob, failJob } from "./uploadJobs";

// Sequential background runner for "Convert All" batches — deliberately never runs two ffmpeg
// conversions at once (this is a single always-on VPS process and re-encoding is CPU-heavy). Polls
// for newly queued jobs every POLL_INTERVAL_MS, but drains every already-due job back-to-back
// within a tick so a batch doesn't wait a full interval between each file.
const POLL_INTERVAL_MS = 15_000;

let running = false;
let timer: ReturnType<typeof setInterval> | null = null;

async function runOne(): Promise<boolean> {
  const job = await claimNextQueuedJob();
  if (!job) return false;

  try {
    const localPath = stagedFilePath(job.stagingId);
    const result = await convertLocalFileToMp4(localPath, job.audioIndex);
    const downloadId = randomUUID();
    await moveToDownload(result.tempFilePath, downloadId);

    const subtitleSetId =
      result.subtitles.length > 0
        ? await createSubtitleSet({
            sourceLabel: job.title,
            subtitles: result.subtitles,
            jobId: job.jobId,
            createdBy: job.requestedBy,
          })
        : null;

    await completeJob(job.jobId, downloadId, `${job.title}.mp4`, subtitleSetId);
  } catch (error) {
    console.error(`[conversionQueue] job ${job.jobId} failed:`, error);
    await failJob(job.jobId, error instanceof Error ? error.message : "Conversion failed").catch(() => {});
  } finally {
    await deleteStagedFile(job.stagingId);
  }
  return true;
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (await runOne()) {
      // keep going while more queued jobs are waiting
    }
  } finally {
    running = false;
  }
}

export function startConversionQueue(): void {
  if (timer) return;
  drain().catch((error) => console.error("[conversionQueue] drain failed:", error));
  timer = setInterval(() => {
    drain().catch((error) => console.error("[conversionQueue] drain failed:", error));
  }, POLL_INTERVAL_MS);
}
