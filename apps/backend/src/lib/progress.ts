import { getDb } from "./mongodb";

export type WatchProgress = {
  userId: string;
  fileId: string;
  parentFolderId: string;
  positionSeconds: number;
  durationSeconds: number;
  completed: boolean;
  updatedAt: Date;
};

const COMPLETED_THRESHOLD = 0.95;

async function collection() {
  const db = await getDb();
  return db.collection<WatchProgress>("watchProgress");
}

export async function ensureIndexes() {
  const col = await collection();
  await col.createIndex({ userId: 1, fileId: 1 }, { unique: true });
  await col.createIndex({ userId: 1, parentFolderId: 1 });
}

export async function getProgress(userId: string, fileId: string) {
  const col = await collection();
  return col.findOne({ userId, fileId });
}

export async function getProgressForFolder(userId: string, parentFolderId: string) {
  const col = await collection();
  return col.find({ userId, parentFolderId }).toArray();
}

/** Most recently-watched, not-yet-completed videos for a user, across the whole library — powers
 * a real "Continue Watching" row (not fabricated data). */
export async function getRecentInProgress(userId: string, limit: number) {
  const col = await collection();
  return col
    .find({ userId, completed: false, positionSeconds: { $gt: 0 } })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .toArray();
}

export async function upsertProgress(input: {
  userId: string;
  fileId: string;
  parentFolderId: string;
  positionSeconds: number;
  durationSeconds: number;
}) {
  const col = await collection();
  const completed =
    input.durationSeconds > 0 &&
    input.positionSeconds >= input.durationSeconds * COMPLETED_THRESHOLD;

  await col.updateOne(
    { userId: input.userId, fileId: input.fileId },
    {
      $set: {
        parentFolderId: input.parentFolderId,
        positionSeconds: input.positionSeconds,
        durationSeconds: input.durationSeconds,
        completed,
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
}
