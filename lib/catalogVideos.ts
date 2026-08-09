import { getDb } from "@/lib/mongodb";

export type CatalogVideoStatus = "pending" | "curated" | "published";

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
        createdAt: now,
        curatedAt: null,
        curatedBy: null,
      },
    },
    { upsert: true },
  );
  return { upsertedCount: res.upsertedCount };
}

/** Saves curated metadata. Only advances status out of "pending" — editing an already
 * curated/published video's details never silently changes its publish state; that's a deliberate
 * separate action (see publishVideo/unpublishVideo). */
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
