import { Router } from "express";
import { requireAdmin } from "../../middleware/auth";
import { runScan } from "../../lib/catalogScan";
import { matchCatalog } from "../../lib/episodeArtwork";
import { ensureIndexes as ensureCatalogVideoIndexes } from "../../lib/catalogVideos";
import { ensureIndexes as ensureCatalogFolderIndexes } from "../../lib/catalogFolders";

const router = Router();

router.post("/", requireAdmin, async (_req, res) => {
  await Promise.all([ensureCatalogVideoIndexes(), ensureCatalogFolderIndexes()]);
  const result = await runScan();
  // New movies and series get their artwork in the background; the admin catalog shows it on
  // its next refresh.
  matchCatalog().catch((error) => console.error("Artwork auto-match failed:", error));
  res.json(result);
});

export default router;
