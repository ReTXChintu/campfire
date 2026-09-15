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
  // both can look themselves up by. subtitleLanguage/subtitleTitle are the same idea for
  // subtitles — subtitleIndex alone only round-trips safely on the exact same video (its meaning
  // is "index into *this file's* subtitles/probe list"), which breaks the moment a preference is
  // reused on a different episode's own, differently-ordered list (see
  // routes/catalog.ts's series-wide fallback). Name-matching resolves that: clients look up
  // subtitleLanguage/subtitleTitle in whatever the current video's own track list is, falling back
  // to "off"/default when no match exists there.
  subtitleSource?: SubtitleSource;
  subtitleIndex?: number | null;
  subtitleLanguage?: string | null;
  subtitleTitle?: string | null;
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

/** The most recently-touched track preference anywhere else in this series (folder) — powers
 * "pick the audio/subtitle once, every other episode follows" for a video the user hasn't
 * personally set a preference on yet. `excludeFileId` skips the video currently being loaded
 * (its own progress doc, if any, already takes priority and is checked separately). */
export async function getMostRecentPreferenceForFolder(
  userId: string,
  parentFolderId: string,
  excludeFileId: string,
) {
  const col = await collection();
  return col.findOne(
    {
      userId,
      parentFolderId,
      fileId: { $ne: excludeFileId },
      $or: [{ subtitleSource: { $exists: true } }, { audioLanguage: { $exists: true } }],
    },
    { sort: { updatedAt: -1 } },
  );
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
  subtitleLanguage?: string | null;
  subtitleTitle?: string | null;
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
  if (input.subtitleLanguage !== undefined) set.subtitleLanguage = input.subtitleLanguage;
  if (input.subtitleTitle !== undefined) set.subtitleTitle = input.subtitleTitle;
  if (input.audioLanguage !== undefined) set.audioLanguage = input.audioLanguage;
  if (input.audioTitle !== undefined) set.audioTitle = input.audioTitle;

  await col.updateOne(
    { userId: input.userId, fileId: input.fileId },
    { $set: set },
    { upsert: true },
  );
}
