import { Router } from "express";
import { Readable } from "node:stream";
import { getThumbnail, streamFile, readDriveHeader } from "../lib/drive";
import { getCatalogFolder } from "../lib/catalogFolders";
import { requireMediaAccess } from "../middleware/mediaAuth";

const router = Router();

router.get("/:fileId", requireMediaAccess("fileId"), async (req, res) => {
  const { fileId } = req.params;
  try {
    const thumbRes = await getThumbnail(fileId);
    if (!thumbRes || !thumbRes.body) {
      res.status(404).json({ error: "No thumbnail" });
      return;
    }

    res.setHeader("content-type", thumbRes.headers.get("content-type") || "image/jpeg");
    res.setHeader("cache-control", "private, max-age=3600");
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
  if (!folder?.thumbnailFileId) {
    res.status(404).json({ error: "No thumbnail" });
    return;
  }

  try {
    const driveRes = await streamFile(folder.thumbnailFileId, null);
    const contentType = readDriveHeader(driveRes.headers, "content-type");
    res.setHeader("content-type", contentType || "image/jpeg");
    res.setHeader("cache-control", "private, max-age=3600");
    driveRes.data.pipe(res);
  } catch {
    res.status(404).json({ error: "No thumbnail" });
  }
});

export default router;
