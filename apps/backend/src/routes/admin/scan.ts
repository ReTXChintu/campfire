import { Router } from "express";
import { requireAdmin } from "../../middleware/auth";
import { runScan } from "../../lib/catalogScan";
import { ensureIndexes as ensureCatalogVideoIndexes } from "../../lib/catalogVideos";
import { ensureIndexes as ensureCatalogFolderIndexes } from "../../lib/catalogFolders";

const router = Router();

router.post("/", requireAdmin, async (_req, res) => {
  await Promise.all([ensureCatalogVideoIndexes(), ensureCatalogFolderIndexes()]);
  const result = await runScan();
  res.json(result);
});

export default router;
