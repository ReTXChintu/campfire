import { listFolderWithThumbnail } from "./drive";
import { env } from "../config/env";
import {
  upsertScannedFolder,
  updateFolderThumbnail,
  listAllFolders,
  deleteFoldersByIds,
} from "./catalogFolders";
import {
  upsertScannedVideo,
  listAllVideos,
  deleteVideosByIds,
} from "./catalogVideos";
import { unlinkSubtitleSetsForVideos } from "./subtitleSets";

const MAX_DEPTH = 12;
const NEW_ITEMS_CAP = 200;

export type ScanResult = {
  foldersScanned: number;
  videosScanned: number;
  foldersAdded: number;
  videosAdded: number;
  foldersDeleted: number;
  videosDeleted: number;
  newFolders: { id: string; driveName: string; parentFolderId: string }[];
  newFoldersTruncated: boolean;
  newVideos: { id: string; driveName: string; parentFolderId: string; mimeType: string }[];
  newVideosTruncated: boolean;
  deletedFolders: { id: string; driveName: string }[];
  deletedFoldersTruncated: boolean;
  deletedVideos: { id: string; driveName: string }[];
  deletedVideosTruncated: boolean;
  erroredFolderIds: string[];
};

/**
 * Walks the Drive tree from the root, upserting every folder/video into the catalog collections,
 * then sweeps away any previously-known folder/video that no longer exists in Drive. Iterative BFS
 * (not recursion) with an explicit queue — a folder/file can technically have more than one Drive
 * parent, so a `visited` set guards against a double-walk or pathological loop, and `MAX_DEPTH` is
 * a defensive cap for the same reason (real content is 2-3 levels deep).
 *
 * Upserts are split so a re-scan never overwrites admin-curated data: Drive-truth fields (name,
 * mimeType, parent, etc.) refresh on every visit; curated fields (title, status, intro/outro,
 * subtitle links) are set only on first insert. Folders are always re-walked even if already known
 * — new episodes can land in an already-catalogued season between scans — only the per-item upsert
 * itself is insert-safe, not the tree walk.
 *
 * Deletion safety: a folder we failed to list (Drive error) or chose not to walk into (depth cap)
 * must never make its previously-known contents look "deleted" just because we didn't get a chance
 * to re-see them this run — that would be silent, incorrect data loss on a transient blip. Every
 * such folder's entire previously-known subtree (computed from what the DB already knew before this
 * scan, since we can't re-walk it) is excluded from the deletion sweep.
 */
export async function runScan(): Promise<ScanResult> {
  const result: ScanResult = {
    foldersScanned: 0,
    videosScanned: 0,
    foldersAdded: 0,
    videosAdded: 0,
    foldersDeleted: 0,
    videosDeleted: 0,
    newFolders: [],
    newFoldersTruncated: false,
    newVideos: [],
    newVideosTruncated: false,
    deletedFolders: [],
    deletedFoldersTruncated: false,
    deletedVideos: [],
    deletedVideosTruncated: false,
    erroredFolderIds: [],
  };

  // Snapshot of everything the DB already knew, before this run — the baseline the deletion sweep
  // diffs against. Loading it fully into memory is fine at personal-library scale.
  const [knownFolders, knownVideos] = await Promise.all([listAllFolders(), listAllVideos()]);
  const knownFoldersById = new Map(knownFolders.map((f) => [f._id, f]));
  const knownVideosById = new Map(knownVideos.map((v) => [v._id, v]));
  const childFolderIdsByParent = new Map<string, string[]>();
  for (const folder of knownFolders) {
    const siblings = childFolderIdsByParent.get(folder.parentFolderId) ?? [];
    siblings.push(folder._id);
    childFolderIdsByParent.set(folder.parentFolderId, siblings);
  }

  const visited = new Set<string>();
  const seenFolderIds = new Set<string>();
  const seenVideoIds = new Set<string>();
  const unwalkedFolderIds = new Set<string>(); // errored or depth-capped — subtree excluded from deletion
  const queue: { folderId: string; depth: number }[] = [{ folderId: env.driveRootFolderId, depth: 0 }];

  while (queue.length > 0) {
    const { folderId, depth } = queue.shift()!;
    if (visited.has(folderId)) continue;
    if (depth > MAX_DEPTH) {
      unwalkedFolderIds.add(folderId);
      continue;
    }
    visited.add(folderId);

    let contents;
    try {
      contents = await listFolderWithThumbnail(folderId);
    } catch (error) {
      console.error(`[scan] failed to list folder ${folderId}:`, error);
      result.erroredFolderIds.push(folderId);
      unwalkedFolderIds.add(folderId);
      continue;
    }
    const { items, thumbnailFileId } = contents;
    await updateFolderThumbnail(folderId, thumbnailFileId);

    for (const item of items) {
      if (item.kind === "folder") {
        result.foldersScanned++;
        seenFolderIds.add(item.id);
        const { upsertedCount } = await upsertScannedFolder({
          folderId: item.id,
          parentFolderId: folderId,
          driveName: item.name,
        });
        if (upsertedCount > 0) {
          result.foldersAdded++;
          if (result.newFolders.length < NEW_ITEMS_CAP) {
            result.newFolders.push({ id: item.id, driveName: item.name, parentFolderId: folderId });
          } else {
            result.newFoldersTruncated = true;
          }
        }
        queue.push({ folderId: item.id, depth: depth + 1 });
      } else {
        result.videosScanned++;
        seenVideoIds.add(item.id);
        const durationMillis = item.durationMillis ? Number(item.durationMillis) : 0;
        const sizeBytes = item.size ? Number(item.size) : null;
        const { upsertedCount } = await upsertScannedVideo({
          fileId: item.id,
          parentFolderId: folderId,
          driveName: item.name,
          mimeType: item.mimeType,
          sizeBytes: sizeBytes && sizeBytes > 0 ? sizeBytes : null,
          durationSeconds: durationMillis > 0 ? durationMillis / 1000 : null,
        });
        if (upsertedCount > 0) {
          result.videosAdded++;
          if (result.newVideos.length < NEW_ITEMS_CAP) {
            result.newVideos.push({
              id: item.id,
              driveName: item.name,
              parentFolderId: folderId,
              mimeType: item.mimeType,
            });
          } else {
            result.newVideosTruncated = true;
          }
        }
      }
    }
  }

  // Expand every unwalked folder to its full previously-known subtree (using the pre-scan
  // snapshot, since we have no live data for it) — none of it is eligible for deletion this run.
  const skipFolderIds = new Set<string>(unwalkedFolderIds);
  const expandQueue = [...unwalkedFolderIds];
  while (expandQueue.length > 0) {
    const id = expandQueue.pop()!;
    for (const childId of childFolderIdsByParent.get(id) ?? []) {
      if (!skipFolderIds.has(childId)) {
        skipFolderIds.add(childId);
        expandQueue.push(childId);
      }
    }
  }

  const missingFolderIds = knownFolders
    .map((f) => f._id)
    .filter((id) => !seenFolderIds.has(id) && !skipFolderIds.has(id));
  const missingVideoIds = knownVideos
    .filter((v) => !seenVideoIds.has(v._id) && !skipFolderIds.has(v.parentFolderId))
    .map((v) => v._id);

  if (missingVideoIds.length > 0) {
    await unlinkSubtitleSetsForVideos(missingVideoIds);
    result.videosDeleted = await deleteVideosByIds(missingVideoIds);
    for (const id of missingVideoIds) {
      const known = knownVideosById.get(id);
      if (!known) continue;
      if (result.deletedVideos.length < NEW_ITEMS_CAP) {
        result.deletedVideos.push({ id, driveName: known.driveName });
      } else {
        result.deletedVideosTruncated = true;
      }
    }
  }
  if (missingFolderIds.length > 0) {
    result.foldersDeleted = await deleteFoldersByIds(missingFolderIds);
    for (const id of missingFolderIds) {
      const known = knownFoldersById.get(id);
      if (!known) continue;
      if (result.deletedFolders.length < NEW_ITEMS_CAP) {
        result.deletedFolders.push({ id, driveName: known.driveName });
      } else {
        result.deletedFoldersTruncated = true;
      }
    }
  }

  return result;
}
