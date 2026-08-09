import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile, readdir, stat, unlink } from "node:fs/promises";

// Staged-upload filenames are derived deterministically from a UUID (`stagingId`) generated at
// stage time — validate the format before building a path from client-supplied input, since this
// is the only thing standing between an admin-only route and path traversal.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertValidStagingId(stagingId: string): void {
  if (!UUID_RE.test(stagingId)) throw new Error("Invalid stagingId");
}

export function stagedFilePath(stagingId: string): string {
  assertValidStagingId(stagingId);
  return join(tmpdir(), `stage-${stagingId}.bin`);
}

export function stagedMetaPath(stagingId: string): string {
  assertValidStagingId(stagingId);
  return join(tmpdir(), `stage-${stagingId}.json`);
}

export type StagedMeta = { mimeType: string; sizeBytes: number };

export async function readStagedMeta(stagingId: string): Promise<StagedMeta> {
  const raw = await readFile(stagedMetaPath(stagingId), "utf-8");
  return JSON.parse(raw);
}

export async function deleteStagedFile(stagingId: string): Promise<void> {
  await unlink(stagedFilePath(stagingId)).catch(() => {});
  await unlink(stagedMetaPath(stagingId)).catch(() => {});
}

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

/** Deletes staged files nobody ever converted (the admin picked a file, then never clicked
 * Convert — nothing else ever cleans these up). Best-effort, called opportunistically whenever a
 * new staging starts; age is judged by the .bin file's own mtime, since it's written once and
 * never touched again after staging completes. */
export async function sweepStaleStagedFiles(maxAgeMs: number = DEFAULT_MAX_AGE_MS): Promise<void> {
  const dir = tmpdir();
  const cutoff = Date.now() - maxAgeMs;
  const entries = await readdir(dir).catch(() => []);
  for (const name of entries) {
    if (!name.startsWith("stage-") || !name.endsWith(".bin")) continue;
    const filePath = join(dir, name);
    const stats = await stat(filePath).catch(() => null);
    if (!stats || stats.mtimeMs > cutoff) continue;
    await unlink(filePath).catch(() => {});
    await unlink(join(dir, name.replace(/\.bin$/, ".json"))).catch(() => {});
  }
}
