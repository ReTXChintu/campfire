import { getDb } from "@/lib/mongodb";

export type CatalogFolderStatus = "pending" | "curated" | "published";

export type CatalogFolder = {
  _id: string; // Drive folder id
  parentFolderId: string; // Drive parent folder id; env.driveRootFolderId for a top-level series
  driveName: string; // refreshed every scan
  thumbnailFileId: string | null; // Drive file id of a "thumbnail.*" image in this folder — refreshed every scan
  status: CatalogFolderStatus;
  title: string | null;
  createdAt: Date;
  curatedAt: Date | null;
  curatedBy: string | null;
  updatedAt: Date;
};

async function collection() {
  const db = await getDb();
  return db.collection<CatalogFolder>("catalogFolders");
}

export async function ensureIndexes() {
  const col = await collection();
  await col.createIndex({ parentFolderId: 1, status: 1 });
}

export async function getCatalogFolder(folderId: string): Promise<CatalogFolder | null> {
  const col = await collection();
  return col.findOne({ _id: folderId });
}

/** Visible to viewers — the publish gate. */
export async function listPublishedFoldersByParent(parentFolderId: string): Promise<CatalogFolder[]> {
  const col = await collection();
  return col.find({ parentFolderId, status: "published" }).toArray();
}

export async function listChildFolders(parentFolderId: string): Promise<CatalogFolder[]> {
  const col = await collection();
  return col.find({ parentFolderId }).toArray();
}

export async function listPendingFolders(): Promise<CatalogFolder[]> {
  const col = await collection();
  return col.find({ status: "pending" }).toArray();
}

/** Curated but not yet published — the "ready to publish" worklist. */
export async function listUnpublishedCuratedFolders(): Promise<CatalogFolder[]> {
  const col = await collection();
  return col.find({ status: "curated" }).toArray();
}

/** Every known folder, minimal enough for the scan's deletion-sweep to diff against a fresh Drive walk. */
export async function listAllFolders(): Promise<Pick<CatalogFolder, "_id" | "parentFolderId" | "driveName">[]> {
  const col = await collection();
  return col.find({}, { projection: { _id: 1, parentFolderId: 1, driveName: 1 } }).toArray();
}

export async function deleteFoldersByIds(folderIds: string[]): Promise<number> {
  if (folderIds.length === 0) return 0;
  const col = await collection();
  const res = await col.deleteMany({ _id: { $in: folderIds } });
  return res.deletedCount;
}

// thumbnailFileId is deliberately absent from this $set — it's not something a folder's PARENT
// listing tells us, only something we learn once we successfully list the folder's OWN contents
// (see updateFolderThumbnail, called from the scan when it walks into this folder itself).
export async function upsertScannedFolder(input: {
  folderId: string;
  parentFolderId: string;
  driveName: string;
}): Promise<{ upsertedCount: number }> {
  const col = await collection();
  const now = new Date();
  const res = await col.updateOne(
    { _id: input.folderId },
    {
      $set: {
        parentFolderId: input.parentFolderId,
        driveName: input.driveName,
        updatedAt: now,
      },
      $setOnInsert: {
        _id: input.folderId,
        thumbnailFileId: null,
        status: "pending" as const,
        title: null,
        createdAt: now,
        curatedAt: null,
        curatedBy: null,
      },
    },
    { upsert: true },
  );
  return { upsertedCount: res.upsertedCount };
}

/** Refreshes a folder's own thumbnail — called when the scan walks into this folder and lists its
 * contents directly. No-op if the folder has no catalog doc yet (e.g. the Drive root itself, which
 * is never inserted as a catalogFolders doc). */
export async function updateFolderThumbnail(
  folderId: string,
  thumbnailFileId: string | null,
): Promise<void> {
  const col = await collection();
  await col.updateOne({ _id: folderId }, { $set: { thumbnailFileId } });
}

/** Saves the curated title. Only advances status out of "pending" — editing an already
 * curated/published folder's title never silently changes its publish state; that's a deliberate
 * separate action (see publishFolder/unpublishFolder). */
export async function curateFolder(
  folderId: string,
  update: { title: string; curatedBy: string },
): Promise<void> {
  const col = await collection();
  await col.updateOne(
    { _id: folderId },
    {
      $set: {
        title: update.title,
        curatedBy: update.curatedBy,
        updatedAt: new Date(),
      },
    },
  );
  await col.updateOne(
    { _id: folderId, status: "pending" },
    { $set: { status: "curated", curatedAt: new Date() } },
  );
}

export async function publishFolder(folderId: string): Promise<{ matched: boolean }> {
  const col = await collection();
  const res = await col.updateOne(
    { _id: folderId, status: "curated" },
    { $set: { status: "published", updatedAt: new Date() } },
  );
  return { matched: res.matchedCount > 0 };
}

export async function unpublishFolder(folderId: string): Promise<{ matched: boolean }> {
  const col = await collection();
  const res = await col.updateOne(
    { _id: folderId, status: "published" },
    { $set: { status: "curated", updatedAt: new Date() } },
  );
  return { matched: res.matchedCount > 0 };
}

/** Walks parentFolderId up to (and including) the root, for breadcrumbs. Depth-guarded against a
 * pathological Drive-parent-graph edge case. */
export async function getBreadcrumbChain(
  folderId: string,
  rootFolderId: string,
): Promise<CatalogFolder[]> {
  const chain: CatalogFolder[] = [];
  let currentId: string | undefined = folderId;
  let guard = 0;
  while (currentId && guard < 12) {
    guard++;
    const folder = await getCatalogFolder(currentId);
    if (!folder) break;
    chain.unshift(folder);
    if (currentId === rootFolderId) break;
    currentId = folder.parentFolderId;
  }
  return chain;
}
