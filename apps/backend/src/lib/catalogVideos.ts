import { getDb } from "./mongodb";
import type { RenditionHeight } from "./qualityLadder";

export type CatalogVideoStatus = "pending" | "curated" | "published";

export type RenditionStatus = "queued" | "processing" | "done" | "failed";
export type RenditionEntry = {
  status: RenditionStatus;
  error: string | null;
  generatedAt: Date | null;
};
// Keyed by height as a string ("480" | "720" | "1080") — Mongo/JSON object keys are always
// strings, and this is looked up dynamically (by requested height) far more often than iterated.
export type CatalogVideoRenditions = Partial<Record<string, RenditionEntry>>;

export type CatalogVideo = {
  _id: string; // Drive file id
  parentFolderId: string; // Drive folder id; env.driveRootFolderId for a top-level movie
  driveName: string; // raw Drive filename — refreshed every scan, admin-facing only
  mimeType: string; // refreshed every scan
  sizeBytes: number | null; // refreshed every scan
  durationSeconds: number | null; // from Drive's videoMediaMetadata at scan time
  status: CatalogVideoStatus;
  title: string | null;
  subtitleSetIds: string[];
  introStart: number | null;
  introEnd: number | null;
  outroStart: number | null;
  // 1-based position within parentFolderId, set by a folder's publish-rule apply (or manual
  // drag-reorder) — null means "not yet ordered", falls back to naturalSort (see
  // lib/catalogListItem.ts's orderEpisodes).
  episodeOrder: number | null;
  // Set whenever an admin edits the corresponding field(s) directly via this video's own curation
  // page (PATCH /:fileId below) — a folder's publish-rule apply always skips a field once its flag
  // is true, so a manual edit "sticks" across rule reapplies. outroStart has no rule/override
  // concept at all; it's always purely manual.
  titleOverridden: boolean;
  introOverridden: boolean; // covers introStart + introEnd together
  renditions: CatalogVideoRenditions;
  createdAt: Date;
  curatedAt: Date | null;
  curatedBy: string | null;
  updatedAt: Date;
};

async function collection() {
  const db = await getDb();
  return db.collection<CatalogVideo>("catalogVideos");
}

export async function ensureIndexes() {
  const col = await collection();
  await col.createIndex({ parentFolderId: 1, status: 1 });
}

export async function getCatalogVideo(fileId: string): Promise<CatalogVideo | null> {
  const col = await collection();
  return col.findOne({ _id: fileId });
}

export async function listCatalogVideosByIds(fileIds: string[]): Promise<CatalogVideo[]> {
  if (fileIds.length === 0) return [];
  const col = await collection();
  return col.find({ _id: { $in: fileIds } }).toArray();
}

/** Visible to viewers — the publish gate. */
export async function listPublishedVideosByParent(parentFolderId: string): Promise<CatalogVideo[]> {
  const col = await collection();
  return col.find({ parentFolderId, status: "published" }).toArray();
}

/** All statuses (pending + curated + published) — for the admin catalog browser, which needs to
 * surface not-yet-curated/not-yet-published items so the admin can act on them. */
export async function listVideosByParent(parentFolderId: string): Promise<CatalogVideo[]> {
  const col = await collection();
  return col.find({ parentFolderId }).toArray();
}

export async function listPendingVideos(): Promise<CatalogVideo[]> {
  const col = await collection();
  return col.find({ status: "pending" }).toArray();
}

/** Curated but not yet published — the "ready to publish" worklist. */
export async function listUnpublishedCuratedVideos(): Promise<CatalogVideo[]> {
  const col = await collection();
  return col.find({ status: "curated" }).toArray();
}

/** Every known video, minimal enough for the scan's deletion-sweep to diff against a fresh Drive walk. */
export async function listAllVideos(): Promise<Pick<CatalogVideo, "_id" | "parentFolderId" | "driveName">[]> {
  const col = await collection();
  return col.find({}, { projection: { _id: 1, parentFolderId: 1, driveName: 1 } }).toArray();
}

export async function deleteVideosByIds(fileIds: string[]): Promise<number> {
  if (fileIds.length === 0) return 0;
  const col = await collection();
  const res = await col.deleteMany({ _id: { $in: fileIds } });
  return res.deletedCount;
}

export async function upsertScannedVideo(input: {
  fileId: string;
  parentFolderId: string;
  driveName: string;
  mimeType: string;
  sizeBytes: number | null;
  durationSeconds: number | null;
}): Promise<{ upsertedCount: number }> {
  const col = await collection();
  const now = new Date();
  const res = await col.updateOne(
    { _id: input.fileId },
    {
      $set: {
        parentFolderId: input.parentFolderId,
        driveName: input.driveName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        durationSeconds: input.durationSeconds,
        updatedAt: now,
      },
      $setOnInsert: {
        _id: input.fileId,
        status: "pending" as const,
        title: null,
        subtitleSetIds: [],
        introStart: null,
        introEnd: null,
        outroStart: null,
        episodeOrder: null,
        titleOverridden: false,
        introOverridden: false,
        renditions: {},
        createdAt: now,
        curatedAt: null,
        curatedBy: null,
      },
    },
    { upsert: true },
  );
  return { upsertedCount: res.upsertedCount };
}

/** Saves curated metadata from this video's own curation page — the manual-edit path, so it always
 * marks title/intro as admin-overridden (see the `titleOverridden`/`introOverridden` field docs on
 * CatalogVideo) so a folder-level publish-rule reapply never clobbers it. Only advances status out
 * of "pending" — editing an already curated/published video's details never silently changes its
 * publish state; that's a deliberate separate action (see publishVideo/unpublishVideo). */
export async function curateVideo(
  fileId: string,
  update: {
    title: string;
    subtitleSetIds: string[];
    introStart: number | null;
    introEnd: number | null;
    outroStart: number | null;
    curatedBy: string;
  },
): Promise<void> {
  const col = await collection();
  await col.updateOne(
    { _id: fileId },
    {
      $set: {
        title: update.title,
        subtitleSetIds: update.subtitleSetIds,
        introStart: update.introStart,
        introEnd: update.introEnd,
        outroStart: update.outroStart,
        curatedBy: update.curatedBy,
        titleOverridden: true,
        introOverridden: true,
        updatedAt: new Date(),
      },
    },
  );
  // Conditional on still being "pending" — matches zero docs (a no-op) once it's already
  // curated/published, which is exactly the point: only the first save promotes it.
  await col.updateOne(
    { _id: fileId, status: "pending" },
    { $set: { status: "curated", curatedAt: new Date() } },
  );
}

/** One video's slice of a folder's publish-rule apply — always sets episodeOrder; sets
 * title/introStart/introEnd only when the corresponding override flag is false (see the field docs
 * on CatalogVideo). Same "advance out of pending once" status semantics as curateVideo, since
 * setting a title for the first time is still what makes a video curated, whether it came from a
 * manual edit or a rule. Returns which fields were actually written, for the endpoint's summary. */
export async function applyRuleToVideo(
  fileId: string,
  update: { episodeOrder: number; title: string | null; introStart: number | null; introEnd: number | null },
): Promise<{ titleApplied: boolean; introApplied: boolean }> {
  const col = await collection();
  const video = await col.findOne({ _id: fileId });
  if (!video) return { titleApplied: false, introApplied: false };

  const titleApplied = !video.titleOverridden && update.title != null;
  const introApplied = !video.introOverridden;

  const set: Record<string, unknown> = { episodeOrder: update.episodeOrder, updatedAt: new Date() };
  if (titleApplied) set.title = update.title;
  if (introApplied) {
    set.introStart = update.introStart;
    set.introEnd = update.introEnd;
  }
  await col.updateOne({ _id: fileId }, { $set: set });

  if (titleApplied) {
    // Same promotion rule as curateVideo: only the first title save advances "pending" → "curated".
    await col.updateOne(
      { _id: fileId, status: "pending" },
      { $set: { status: "curated", curatedAt: new Date() } },
    );
  }

  return { titleApplied, introApplied };
}

const VIDEO_EXTENSION_RE = /\.(mp4|mkv|avi|mov|webm|m4v|wmv|flv|ts|m2ts)$/i;

/** Falls back to the Drive filename (extension stripped) as a still-untitled video's title — lets
 * "Publish all" (see routes/admin/catalogFolder.ts's publish-rule/publish-all) publish a folder's
 * videos immediately without first requiring a rename or a batch naming-pattern apply. Deliberately
 * does *not* set titleOverridden: unlike a real curation, this is just a placeholder, so a later
 * publish-rule apply (or manual edit) still renames it normally. No-op once the video already has
 * any title (curated or published) — never overwrites a real one. */
export async function curateVideoWithDriveNameFallback(fileId: string): Promise<void> {
  const col = await collection();
  const video = await col.findOne({ _id: fileId, status: "pending" });
  if (!video) return;
  await col.updateOne(
    { _id: fileId, status: "pending" },
    {
      $set: {
        title: video.driveName.replace(VIDEO_EXTENSION_RE, ""),
        status: "curated",
        curatedAt: new Date(),
        updatedAt: new Date(),
      },
    },
  );
}

/** Clears one override flag (from the video's own curation page's "Reset to folder rule" link) — the
 * field's value itself is refreshed the next time the parent folder's rule is (re-)applied, not here. */
export async function resetVideoOverride(fileId: string, field: "title" | "intro"): Promise<void> {
  const col = await collection();
  const key = field === "title" ? "titleOverridden" : "introOverridden";
  await col.updateOne({ _id: fileId }, { $set: { [key]: false, updatedAt: new Date() } });
}

/** Appends one subtitleSetId to a video's linked list (used by the direct-upload endpoint, which
 * creates+links a new set in one step and then just needs to register it on the video). */
export async function addSubtitleSetId(fileId: string, subtitleSetId: string): Promise<void> {
  const col = await collection();
  await col.updateOne(
    { _id: fileId },
    { $addToSet: { subtitleSetIds: subtitleSetId }, $set: { updatedAt: new Date() } },
  );
}

export async function publishVideo(fileId: string): Promise<{ matched: boolean }> {
  const col = await collection();
  const res = await col.updateOne(
    { _id: fileId, status: "curated" },
    { $set: { status: "published", updatedAt: new Date() } },
  );
  return { matched: res.matchedCount > 0 };
}

export async function unpublishVideo(fileId: string): Promise<{ matched: boolean }> {
  const col = await collection();
  const res = await col.updateOne(
    { _id: fileId, status: "published" },
    { $set: { status: "curated", updatedAt: new Date() } },
  );
  return { matched: res.matchedCount > 0 };
}

/** Marks the given heights "queued" for this video, ready for renditionQueue.ts to pick up.
 * Re-queuing a height that's already "done"/"failed" clears the old result — a fresh generation. */
export async function queueRenditions(fileId: string, heights: RenditionHeight[]): Promise<void> {
  const col = await collection();
  const set: Record<string, RenditionEntry> = {};
  for (const height of heights) {
    set[`renditions.${height}`] = { status: "queued", error: null, generatedAt: null };
  }
  await col.updateOne({ _id: fileId }, { $set: set });
}

/** Atomically claims one queued rendition job across the whole catalog (checked height-by-height,
 * so all videos' 480p jobs drain before any 720p job starts — fine for personal-library scale,
 * simpler than a fair global ordering). Returns null once nothing is queued. */
export async function claimNextQueuedRendition(
  heights: readonly RenditionHeight[],
): Promise<{ fileId: string; height: RenditionHeight } | null> {
  const col = await collection();
  for (const height of heights) {
    const doc = await col.findOneAndUpdate(
      { [`renditions.${height}.status`]: "queued" },
      { $set: { [`renditions.${height}.status`]: "processing" } },
      { returnDocument: "after" },
    );
    if (doc) return { fileId: doc._id, height };
  }
  return null;
}

export async function markRenditionDone(fileId: string, height: RenditionHeight): Promise<void> {
  const col = await collection();
  await col.updateOne(
    { _id: fileId },
    { $set: { [`renditions.${height}`]: { status: "done", error: null, generatedAt: new Date() } } },
  );
}

export async function markRenditionFailed(fileId: string, height: RenditionHeight, error: string): Promise<void> {
  const col = await collection();
  await col.updateOne(
    { _id: fileId },
    { $set: { [`renditions.${height}`]: { status: "failed", error, generatedAt: null } } },
  );
}
