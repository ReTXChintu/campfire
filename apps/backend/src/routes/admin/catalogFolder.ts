import { Router } from "express";
import { requireAdmin } from "../../middleware/auth";
import { env } from "../../config/env";
import {
  getCatalogFolder,
  getBreadcrumbChain,
  listChildFolders,
  curateFolder,
  publishFolder,
  unpublishFolder,
} from "../../lib/catalogFolders";
import { listVideosByParent } from "../../lib/catalogVideos";

const router = Router();

router.get("/:folderId", requireAdmin, async (req, res) => {
  const { folderId } = req.params;
  const folder = await getCatalogFolder(folderId);
  if (!folder) {
    res.status(404).json({ error: "Folder not found" });
    return;
  }

  const [breadcrumbs, childFolders, childVideos] = await Promise.all([
    getBreadcrumbChain(folderId, env.driveRootFolderId),
    listChildFolders(folderId),
    listVideosByParent(folderId),
  ]);

  res.json({ folder, breadcrumbs, childFolders, childVideos });
});

router.patch("/:folderId", requireAdmin, async (req, res) => {
  const { folderId } = req.params;
  const folder = await getCatalogFolder(folderId);
  if (!folder) {
    res.status(404).json({ error: "Folder not found" });
    return;
  }

  const { title } = req.body as { title?: string };
  const trimmedTitle = title?.trim();
  if (!trimmedTitle) {
    res.status(400).json({ error: "title is required" });
    return;
  }

  await curateFolder(folderId, { title: trimmedTitle, curatedBy: req.authUser!.email });
  res.json({ ok: true });
});

router.post("/:folderId/publish", requireAdmin, async (req, res) => {
  const { folderId } = req.params;
  const { matched } = await publishFolder(folderId);
  if (!matched) {
    res.status(400).json({ error: "Folder must be curated (title set) before it can be published" });
    return;
  }
  res.json({ ok: true });
});

router.post("/:folderId/unpublish", requireAdmin, async (req, res) => {
  const { folderId } = req.params;
  const { matched } = await unpublishFolder(folderId);
  if (!matched) {
    res.status(400).json({ error: "Folder is not currently published" });
    return;
  }
  res.json({ ok: true });
});

export default router;
