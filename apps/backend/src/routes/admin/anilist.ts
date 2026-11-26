import { Router, type Request, type Response } from "express";
import { requireAdmin } from "../../middleware/auth";
import { isTmdbId } from "../../lib/explore";
import { linkDetails, listLinks, parseAdminLink, setAdminLink } from "../../lib/anilistLink";

/**
 * Anime titles as AniList knows them (lib/anilistLink.ts): the admin Anime page.
 *
 *   GET    /api/admin/anilist                       → { titles } every title looked at, newest first
 *   GET    /api/admin/anilist/:type/:tmdbId[?fresh=1] → its table, made (or remade) first if needed
 *   PUT    /api/admin/anilist/:type/:tmdbId          { segments } | { movie } | { off: true }
 *   DELETE /api/admin/anilist/:type/:tmdbId          → back to the automatic table
 */
const router = Router();

function titleOf(req: Request, res: Response): { type: "movie" | "tv"; tmdbId: string } | null {
  const { type, tmdbId } = req.params;
  if ((type !== "movie" && type !== "tv") || !isTmdbId(tmdbId)) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  return { type, tmdbId: String(Number(tmdbId)) };
}

const NOT_ANSWERING = "TMDb or AniList isn't answering — try again in a minute";

router.get("/", requireAdmin, (_req, res, next) => {
  listLinks()
    .then((titles) => res.json({ titles }))
    .catch(next);
});

router.get("/:type/:tmdbId", requireAdmin, (req, res, next) => {
  const title = titleOf(req, res);
  if (!title) return;
  linkDetails(title.type, title.tmdbId, { fresh: req.query.fresh === "1" })
    .then((link) => (link ? res.json(link) : res.status(502).json({ error: NOT_ANSWERING })))
    .catch(next);
});

router.put("/:type/:tmdbId", requireAdmin, async (req, res, next) => {
  const title = titleOf(req, res);
  if (!title) return;
  try {
    const admin = await parseAdminLink(title.type, req.body);
    if (typeof admin === "string") {
      res.status(400).json({ error: admin });
      return;
    }
    if (!(await setAdminLink(title.type, title.tmdbId, admin))) {
      res.status(502).json({ error: NOT_ANSWERING });
      return;
    }
    res.json(await linkDetails(title.type, title.tmdbId));
  } catch (error) {
    next(error);
  }
});

router.delete("/:type/:tmdbId", requireAdmin, async (req, res, next) => {
  const title = titleOf(req, res);
  if (!title) return;
  try {
    if (!(await setAdminLink(title.type, title.tmdbId, null))) {
      res.status(502).json({ error: NOT_ANSWERING });
      return;
    }
    res.json(await linkDetails(title.type, title.tmdbId));
  } catch (error) {
    next(error);
  }
});

export default router;
