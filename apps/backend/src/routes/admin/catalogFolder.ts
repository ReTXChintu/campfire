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
  setFolderPublishRule,
  type CatalogFolderPublishRule,
} from "../../lib/catalogFolders";
import { listVideosByParent, applyRuleToVideo, publishVideo } from "../../lib/catalogVideos";

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

// Batch-names/orders/times every direct child video per the given rule (skipping any field an
// admin has manually overridden on that video), and saves the rule on the folder for next time.
// Deliberately does not publish — see FolderPublishRule.tsx's separate "Publish all" button.
router.post("/:folderId/publish-rule/apply", requireAdmin, async (req, res) => {
  const { folderId } = req.params;
  const folder = await getCatalogFolder(folderId);
  if (!folder) {
    res.status(404).json({ error: "Folder not found" });
    return;
  }

  const { namePattern, padding, introStart, introEnd, order } = req.body as {
    namePattern?: string;
    padding?: number;
    introStart?: number | null;
    introEnd?: number | null;
    order?: string[];
  };

  const trimmedPattern = namePattern?.trim();
  if (!trimmedPattern || !trimmedPattern.includes("{n}")) {
    res.status(400).json({ error: "Naming pattern must include a {n} token" });
    return;
  }
  const padWidth = typeof padding === "number" && padding >= 0 ? Math.floor(padding) : 0;
  if (introStart != null && introEnd != null && introStart >= introEnd) {
    res.status(400).json({ error: "introStart must be before introEnd" });
    return;
  }
  if (!Array.isArray(order) || order.length === 0) {
    res.status(400).json({ error: "order must be a non-empty list of video ids" });
    return;
  }

  const children = await listVideosByParent(folderId);
  const childIds = new Set(children.map((v) => v._id));
  if (order.length !== childIds.size || !order.every((id) => childIds.has(id))) {
    res.status(400).json({ error: "order does not match this folder's current videos — refresh and try again" });
    return;
  }

  const rule: CatalogFolderPublishRule = {
    namePattern: trimmedPattern,
    padding: padWidth,
    introStart: introStart ?? null,
    introEnd: introEnd ?? null,
  };
  await setFolderPublishRule(folderId, rule);

  let updated = 0;
  let skippedTitle = 0;
  let skippedIntro = 0;
  for (let i = 0; i < order.length; i++) {
    const episodeNumber = i + 1;
    const paddedNumber = padWidth > 0 ? String(episodeNumber).padStart(padWidth, "0") : String(episodeNumber);
    const { titleApplied, introApplied } = await applyRuleToVideo(order[i], {
      episodeOrder: episodeNumber,
      title: trimmedPattern.replace("{n}", paddedNumber),
      introStart: rule.introStart,
      introEnd: rule.introEnd,
    });
    updated++;
    if (!titleApplied) skippedTitle++;
    if (!introApplied) skippedIntro++;
  }

  res.json({ ok: true, updated, skippedTitle, skippedIntro });
});

// Publishes the folder (if curated) and every currently-curated child video in one click.
router.post("/:folderId/publish-rule/publish-all", requireAdmin, async (req, res) => {
  const { folderId } = req.params;
  const folder = await getCatalogFolder(folderId);
  if (!folder) {
    res.status(404).json({ error: "Folder not found" });
    return;
  }

  const { matched: folderPublished } = await publishFolder(folderId);

  const children = await listVideosByParent(folderId);
  let publishedVideos = 0;
  for (const video of children) {
    if (video.status !== "curated") continue;
    const { matched } = await publishVideo(video._id);
    if (matched) publishedVideos++;
  }

  res.json({ ok: true, publishedVideos, folderPublished });
});

export default router;
