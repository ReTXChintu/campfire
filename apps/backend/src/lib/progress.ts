import { getDb } from "./mongodb";

// Which array a saved subtitleIndex indexes into — "external" is video.subtitles (the
// admin-curated SubtitleSet list, the same identifier space on all three players/every seekMode);
// "restart" is a raw ffprobe stream index, only meaningful for the live-extracted-on-seek
// subtitle path non-native/non-MKV content uses (see routes/subtitle.ts). "off" is an explicit
// choice to disable subtitles, distinct from having no saved preference at all (absent field).
export type SubtitleSource = "off" | "external" | "restart";

export type WatchProgress = {
  userId: string;
  fileId: string;
  parentFolderId: string;
  positionSeconds: number;
  durationSeconds: number;
  completed: boolean;
  // Remembered track choices — undefined/absent means "no preference recorded yet", not "off".
  // Audio is matched by language+title (not a raw index) since the identifier space genuinely
  // differs by player: web/CampfireVideoPlayer's restart-mode audio is a raw ffprobe stream index,
  // while MediaKitVideoPlayer's is mpv's own track id — language+title is the only representation
  // both can look themselves up by.
  subtitleSource?: SubtitleSource;
  subtitleIndex?: number | null;
  audioLanguage?: string | null;
  audioTitle?: string | null;
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
  subtitleSource?: SubtitleSource;
  subtitleIndex?: number | null;
  audioLanguage?: string | null;
  audioTitle?: string | null;
}) {
  const col = await collection();
  const completed =
    input.durationSeconds > 0 &&
    input.positionSeconds >= input.durationSeconds * COMPLETED_THRESHOLD;

  const set: Record<string, unknown> = {
    parentFolderId: input.parentFolderId,
    positionSeconds: input.positionSeconds,
    durationSeconds: input.durationSeconds,
    completed,
    updatedAt: new Date(),
  };
  // Only touch track-preference fields when the caller actually sent them — an older client, or a
  // save that genuinely has nothing new to say about tracks, shouldn't silently erase a
  // previously-saved preference by omission.
  if (input.subtitleSource !== undefined) set.subtitleSource = input.subtitleSource;
  if (input.subtitleIndex !== undefined) set.subtitleIndex = input.subtitleIndex;
  if (input.audioLanguage !== undefined) set.audioLanguage = input.audioLanguage;
  if (input.audioTitle !== undefined) set.audioTitle = input.audioTitle;

  await col.updateOne(
    { userId: input.userId, fileId: input.fileId },
    { $set: set },
    { upsert: true },
  );
}
