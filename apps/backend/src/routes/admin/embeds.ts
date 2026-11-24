import { Router } from "express";
import { requireAdmin } from "../../middleware/auth";
import { getCatalogVideo } from "../../lib/catalogVideos";
import { tmdbRefOf } from "../../lib/tmdbRef";
import {
  deleteEmbedsByKey,
  embedProviders,
  embedsFor,
  listEmbeds,
  MAX_EMBEDS,
  parseEmbed,
  saveEmbeds,
  searchVideos,
  withStatus,
  type Embed,
} from "../../lib/embed";

/** Embedded players (lib/embed.ts): the admin Embeds page, and the same panel on a video's page. */
const router = Router();

router.get("/", requireAdmin, async (_req, res) => {
  res.json({ providers: embedProviders(), titles: await listEmbeds() });
});

router.get("/search", requireAdmin, async (req, res) => {
  res.json({ videos: await searchVideos(typeof req.query.q === "string" ? req.query.q : "") });
});

router.get("/video/:fileId", requireAdmin, async (req, res) => {
  const video = await getCatalogVideo(req.params.fileId);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  res.json({
    tmdb: tmdbRefOf(video),
    max: MAX_EMBEDS,
    providers: embedProviders(),
    embeds: await withStatus(await embedsFor(video)),
  });
});

/** Replaces the title's players, in the order they should be tried. */
router.put("/video/:fileId", requireAdmin, async (req, res) => {
  const raw = (req.body as { embeds?: unknown }).embeds;
  if (!Array.isArray(raw) || raw.length > MAX_EMBEDS) {
    res.status(400).json({ error: `A title can have up to ${MAX_EMBEDS} players` });
    return;
  }
  const embeds: Embed[] = [];
  for (const [index, value] of raw.entries()) {
    const embed = parseEmbed(value);
    if (typeof embed === "string") {
      res.status(400).json({ error: `Player ${index + 1} ${embed}` });
      return;
    }
    if (embeds.some((e) => e.url === embed.url)) {
      res.status(400).json({ error: `Player ${index + 1} is already in the list` });
      return;
    }
    embeds.push(embed);
  }
  const video = await getCatalogVideo(req.params.fileId);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  await saveEmbeds(video, embeds);
  res.json({ embeds: await withStatus(embeds) });
});

/** For a title whose files are no longer in the catalog, so it has no video page to edit it on. */
router.delete("/:key", requireAdmin, async (req, res) => {
  if (!(await deleteEmbedsByKey(req.params.key))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ ok: true });
});

export default router;
