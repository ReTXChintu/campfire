import { Router, type Response } from "express";
import { Readable } from "node:stream";
import { getThumbnail, streamFile, readDriveHeader } from "../lib/drive";
import { getCatalogFolder } from "../lib/catalogFolders";
import { getCatalogVideo } from "../lib/catalogVideos";
import { requireMediaAccess } from "../middleware/mediaAuth";
import { requireAuth } from "../middleware/auth";
import {
  artworkImageFile,
  castImage,
  folderImageSource,
  parseArtworkShape,
  videoImage,
  type ArtworkImage,
} from "../lib/artwork";

const IMAGE_CACHE = "private, max-age=3600";

/** Sends a cached TMDb image; false when it couldn't be fetched, so the caller falls back. */
async function sendArtwork(res: Response, image: ArtworkImage): Promise<boolean> {
  const file = await artworkImageFile(image);
  if (!file) return false;
  res.setHeader("cache-control", IMAGE_CACHE);
  res.sendFile(file);
  return true;
}

const router = Router();

router.get("/:fileId", requireMediaAccess("fileId"), async (req, res) => {
  const { fileId } = req.params;
  const shape = parseArtworkShape(req.query.shape);
  // A movie matched to TMDb shows its backdrop, an episode its own still from TMDb; anything
  // unmatched (or TMDb unreachable) keeps Drive's own frame grab.
  const video = await getCatalogVideo(fileId);
  const image = video ? videoImage(video, shape) : null;
  if (image && (await sendArtwork(res, image))) return;
  // A wordmark has no stand-in: the client writes the title in text instead.
  if (shape === "logo") {
    res.status(404).json({ error: "No logo" });
    return;
  }
  try {
    const thumbRes = await getThumbnail(fileId);
    if (!thumbRes || !thumbRes.body) {
      res.status(404).json({ error: "No thumbnail" });
      return;
    }

    res.setHeader("content-type", thumbRes.headers.get("content-type") || "image/jpeg");
    res.setHeader("cache-control", IMAGE_CACHE);
    Readable.fromWeb(thumbRes.body as import("node:stream/web").ReadableStream<Uint8Array>).pipe(res);
  } catch {
    res.status(404).json({ error: "No thumbnail" });
  }
});

// Serves the full-resolution "thumbnail.*" image uploaded into a Drive folder — not Drive's own
// auto-generated (low-res) thumbnailLink preview used for videos, since this is a real admin-picked
// poster image and deserves full quality. Mounted separately (see index.ts) as /api/thumbnail-folder
// so its :folderId param doesn't collide with the /:fileId route above.
export const folderThumbnailRouter = Router();

folderThumbnailRouter.get("/:folderId", requireMediaAccess("folderId"), async (req, res) => {
  const { folderId } = req.params;
  const shape = parseArtworkShape(req.query.shape);
  const folder = await getCatalogFolder(folderId);
  const source = folder ? folderImageSource(folder, shape) : null;
  if (source?.kind === "artwork" && (await sendArtwork(res, source.image))) return;
  if (shape === "logo") {
    res.status(404).json({ error: "No logo" });
    return;
  }
  // TMDb unreachable: a Drive image, if the folder has one, still beats a blank card.
  const driveFileId = folder?.thumbnailFileId;
  if (!driveFileId) {
    res.status(404).json({ error: "No thumbnail" });
    return;
  }

  try {
    const driveRes = await streamFile(driveFileId, null);
    const contentType = readDriveHeader(driveRes.headers, "content-type");
    res.setHeader("content-type", contentType || "image/jpeg");
    res.setHeader("cache-control", IMAGE_CACHE);
    driveRes.data.pipe(res);
  } catch {
    res.status(404).json({ error: "No thumbnail" });
  }
});

// A cast member's headshot, addressed by their position in the title's stored cast list rather
// than by a TMDb path — so no client can ask this server to fetch an arbitrary URL. Mounted as
// /api/cast-image (see index.ts). Plain `requireAuth`: both clients load images through an
// authenticated fetch, so there's no header-less <img> to mint a media token for.
export const castImageRouter = Router();

castImageRouter.get("/:kind/:id/:index", requireAuth, async (req, res) => {
  const { kind, id } = req.params;
  const index = Number(req.params.index);
  if ((kind !== "folder" && kind !== "video") || !Number.isInteger(index) || index < 0) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const doc = kind === "folder" ? await getCatalogFolder(id) : await getCatalogVideo(id);
  const image = castImage(doc?.artwork, index);
  if (!image || !(await sendArtwork(res, image))) {
    res.status(404).json({ error: "No image" });
    return;
  }
});

export default router;
