import { tmpdir } from "node:os";
import { join } from "node:path";
import { rename, unlink } from "node:fs/promises";

// Same validation approach as lib/staging.ts — downloadIds are always server-generated UUIDs, but
// validate the shape anyway before building a filesystem path from it.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertValidDownloadId(downloadId: string): void {
  if (!UUID_RE.test(downloadId)) throw new Error("Invalid downloadId");
}

export function downloadFilePath(downloadId: string): string {
  assertValidDownloadId(downloadId);
  return join(tmpdir(), `download-${downloadId}.mp4`);
}

/** Moves a completed conversion's temp output into the download-ready location (same filesystem,
 * so this is an instant rename, not a copy). */
export async function moveToDownload(tempFilePath: string, downloadId: string): Promise<void> {
  await rename(tempFilePath, downloadFilePath(downloadId));
}

export async function deleteDownloadFile(downloadId: string): Promise<void> {
  await unlink(downloadFilePath(downloadId)).catch(() => {});
}
