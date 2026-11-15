import { createWriteStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { env } from "../config/env";

/** A reference image is a poster or a screenshot somebody attached to a request so the admin can
 * tell which release they actually mean. Small, permanent-ish files — they live next to the
 * renditions on disk, not in the OS temp dir (unlike lib/staging.ts's short-lived uploads), since
 * a request can sit in the queue for weeks. */

export const MAX_REQUEST_IMAGE_BYTES = 5 * 1024 * 1024;

const EXT_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export function isAllowedImageMime(mimeType: string): boolean {
  return mimeType.split(";")[0].trim().toLowerCase() in EXT_BY_MIME;
}

export function mimeForImageId(imageId: string): string {
  const ext = extname(imageId).toLowerCase();
  const found = Object.entries(EXT_BY_MIME).find(([, value]) => value === ext);
  return found ? found[0] : "application/octet-stream";
}

// Ids are `<uuid><ext>` and are built here, never taken from the client — but they do come back
// from the client on the way out (GET /api/request-image/:id), so the shape is re-validated
// before any of them is turned into a path. Same reasoning as staging.ts's assertValidStagingId.
const IMAGE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|gif)$/i;

export function isValidImageId(imageId: string): boolean {
  return IMAGE_ID_RE.test(imageId);
}

export function requestImagePath(imageId: string): string {
  if (!isValidImageId(imageId)) throw new Error("Invalid image id");
  return join(env.requestImagesDir, imageId);
}

export class ImageTooLargeError extends Error {
  constructor() {
    super(`Reference image is larger than ${Math.round(MAX_REQUEST_IMAGE_BYTES / 1024 / 1024)}MB`);
    this.name = "ImageTooLargeError";
  }
}

/** Streams an upload to disk, refusing anything over the cap *while* it's being written rather
 * than after — otherwise a large POST would be fully absorbed before being rejected. */
export async function saveRequestImage(source: Readable, mimeType: string): Promise<{ imageId: string; sizeBytes: number }> {
  const normalized = mimeType.split(";")[0].trim().toLowerCase();
  const ext = EXT_BY_MIME[normalized];
  if (!ext) throw new Error(`Unsupported image type: ${normalized}`);

  await mkdir(env.requestImagesDir, { recursive: true });
  const imageId = `${randomUUID()}${ext}`;
  const filePath = join(env.requestImagesDir, imageId);

  let received = 0;
  let tooLarge = false;
  source.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (received > MAX_REQUEST_IMAGE_BYTES && !tooLarge) {
      tooLarge = true;
      source.destroy(new ImageTooLargeError());
    }
  });

  try {
    await pipeline(source, createWriteStream(filePath));
  } catch (error) {
    await unlink(filePath).catch(() => {});
    if (tooLarge) throw new ImageTooLargeError();
    throw error;
  }

  const { size } = await stat(filePath);
  return { imageId, sizeBytes: size };
}

export async function deleteRequestImage(imageId: string): Promise<void> {
  if (!isValidImageId(imageId)) return;
  await unlink(join(env.requestImagesDir, imageId)).catch(() => {});
}
