import { Router } from "express";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { requireAdmin } from "../../middleware/auth";
import { downloadFilePath, deleteDownloadFile } from "../../lib/downloads";

const router = Router();

// Serves a locally-converted MP4 for the admin to save to their own device, then deletes the temp
// file once the response has finished streaming — nothing here ever touches Drive.
router.get("/:downloadId", requireAdmin, async (req, res) => {
  const { downloadId } = req.params;
  const filename = typeof req.query.filename === "string" ? req.query.filename : "video.mp4";

  let filePath: string;
  let size: number;
  try {
    filePath = downloadFilePath(downloadId);
    size = (await stat(filePath)).size;
  } catch {
    res.status(404).json({ error: "Download not found" });
    return;
  }

  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Length", String(size));
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);

  const stream = createReadStream(filePath);
  stream.pipe(res);
  res.on("finish", () => {
    deleteDownloadFile(downloadId).catch(() => {});
  });
  res.on("close", () => stream.destroy());
});

export default router;
