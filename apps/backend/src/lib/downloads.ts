import { tmpdir } from "node:os";
import { join } from "node:path";
import { readdir, rename, stat, unlink } from "node:fs/promises";

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

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

/** Deletes converted files nobody ever actually downloaded (conversion finished, but the browser
 * tab was closed, or the download link was never clicked) — the normal cleanup only runs once the
 * download route's response has finished streaming, which never happens otherwise. Best-effort,
 * called opportunistically whenever a new conversion starts. */
export async function sweepStaleDownloads(maxAgeMs: number = DEFAULT_MAX_AGE_MS): Promise<void> {
  const dir = tmpdir();
  const cutoff = Date.now() - maxAgeMs;
  const entries = await readdir(dir).catch(() => []);
  for (const name of entries) {
    if (!name.startsWith("download-") || !name.endsWith(".mp4")) continue;
    const filePath = join(dir, name);
    const stats = await stat(filePath).catch(() => null);
    if (!stats || stats.mtimeMs > cutoff) continue;
    await unlink(filePath).catch(() => {});
  }
}
