import { getDb } from "./mongodb";

// Tracks a background convert-to-download job. Needed because a local ffmpeg conversion (with a
// possible video re-encode) can take a while — the request that kicks it off returns immediately
// and the client polls this instead of holding a connection open.
export type UploadJobStatus = "processing" | "done" | "failed";

export type UploadJobDoc = {
  jobId: string;
  status: UploadJobStatus;
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

export async function createJob(jobId: string, requestedBy: string) {
  const col = await collection();
  await col.insertOne({ jobId, status: "processing", createdAt: new Date(), requestedBy });
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
