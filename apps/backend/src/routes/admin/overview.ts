import { Router } from "express";
import { requireAdmin } from "../../middleware/auth";
import { env } from "../../config/env";
import { listPendingFolders, listUnpublishedCuratedFolders, listChildFolders } from "../../lib/catalogFolders";
import { listPendingVideos, listUnpublishedCuratedVideos, listVideosByParent } from "../../lib/catalogVideos";

const router = Router();

router.get("/", requireAdmin, async (_req, res) => {
  const [pendingFolders, pendingVideos, unpublishedFolders, unpublishedVideos, rootFolders, rootVideos] =
    await Promise.all([
      listPendingFolders(),
      listPendingVideos(),
      listUnpublishedCuratedFolders(),
      listUnpublishedCuratedVideos(),
      listChildFolders(env.driveRootFolderId),
      listVideosByParent(env.driveRootFolderId),
    ]);

  res.json({ pendingFolders, pendingVideos, unpublishedFolders, unpublishedVideos, rootFolders, rootVideos });
});

export default router;
