import { randomUUID } from "node:crypto";
import { getDb } from "./mongodb";

// Tracks a background convert-to-download job. Needed because a local ffmpeg conversion (with a
// possible video re-encode) can take a while — the request that kicks it off returns immediately
// and the client polls this instead of holding a connection open. Jobs from one "Convert All"
// batch share a batchId and run strictly one at a time (see lib/conversionQueue.ts) — never
// concurrently — since ffmpeg re-encoding is CPU-heavy and this is a single VPS process.
export type UploadJobStatus = "queued" | "processing" | "done" | "failed";

export type UploadJobDoc = {
  jobId: string;
  batchId: string;
  order: number;
  status: UploadJobStatus;
  stagingId: string;
  title: string;
  audioIndex: number;
  downloadId?: string;
  filename?: string;
  subtitleSetId?: string | null;
  error?: string;
  createdAt: Date;
  requestedBy: string;
};

async function collection() {
  const db = await getDb();
  return db.collection<UploadJobDoc>("uploadJobs");
}

export type ConvertItem = { stagingId: string; title: string; audioIndex: number };

export async function createJobs(
  items: ConvertItem[],
  requestedBy: string,
): Promise<{ batchId: string; jobIds: string[] }> {
  const col = await collection();
  const batchId = randomUUID();
  const createdAt = new Date();
  const docs: UploadJobDoc[] = items.map((item, order) => ({
    jobId: randomUUID(),
    batchId,
    order,
    status: "queued",
    stagingId: item.stagingId,
    title: item.title,
    audioIndex: item.audioIndex,
    createdAt,
    requestedBy,
  }));
  await col.insertMany(docs);
  return { batchId, jobIds: docs.map((d) => d.jobId) };
}

export async function getJobsByBatch(batchId: string): Promise<UploadJobDoc[]> {
  const col = await collection();
  return col.find({ batchId }).sort({ order: 1 }).toArray();
}

/** Atomically claims the oldest still-queued job across all batches and marks it "processing" —
 * called by the conversion queue runner, never directly by a route. FIFO across batches (not just
 * within one) so an earlier "Convert All" finishes before a later one starts. */
export async function claimNextQueuedJob(): Promise<UploadJobDoc | null> {
  const col = await collection();
  return col.findOneAndUpdate(
    { status: "queued" },
    { $set: { status: "processing" } },
    { sort: { createdAt: 1, order: 1 }, returnDocument: "after" },
  );
}

/** True if any job referencing this stagingId is still queued or processing — used by
 * sweepStaleStagedFiles to avoid deleting a file mid-queue. */
export async function hasLiveJobForStaging(stagingId: string): Promise<boolean> {
  const col = await collection();
  const doc = await col.findOne({ stagingId, status: { $in: ["queued", "processing"] } });
  return doc != null;
}

export async function completeJob(
  jobId: string,
  downloadId: string,
  filename: string,
  subtitleSetId: string | null,
) {
  const col = await collection();
  await col.updateOne({ jobId }, { $set: { status: "done", downloadId, filename, subtitleSetId } });
}

export async function failJob(jobId: string, error: string) {
  const col = await collection();
  await col.updateOne({ jobId }, { $set: { status: "failed", error } });
}

export async function getJob(jobId: string) {
  const col = await collection();
  return col.findOne({ jobId });
}
