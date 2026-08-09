import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile, unlink } from "node:fs/promises";

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
