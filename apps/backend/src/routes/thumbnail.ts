import { Router, type Response } from "express";
import { Readable } from "node:stream";
import { getThumbnail, streamFile, readDriveHeader } from "../lib/drive";
import { getCatalogFolder } from "../lib/catalogFolders";
import { getCatalogVideo } from "../lib/catalogVideos";
import { requireMediaAccess } from "../middleware/mediaAuth";
import { artworkImage, artworkImageFile, folderImageSource, type ArtworkImage } from "../lib/artwork";

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
  // A movie matched to TMDb shows its backdrop; everything else (episodes, unmatched titles, or
  // TMDb unreachable) keeps Drive's own frame grab.
  const image = artworkImage((await getCatalogVideo(fileId))?.artwork);
  if (image && (await sendArtwork(res, image))) return;
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
  const folder = await getCatalogFolder(folderId);
  const source = folder ? folderImageSource(folder) : null;
  if (source?.kind === "artwork" && (await sendArtwork(res, source.image))) return;
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

export default router;
