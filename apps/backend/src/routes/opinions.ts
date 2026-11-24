import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { isTmdbId } from "../lib/explore";
import { forYou } from "../lib/forYou";
import { listOpinions, parseOpinionChange, setOpinion } from "../lib/opinions";

/**
 * What the viewer has watched, liked and disliked (lib/opinions.ts), and what that suggests
 * (lib/forYou.ts).
 *
 *   GET /api/opinions                 → { opinions: [{ type, id, watched, rating }] }
 *   PUT /api/opinions/:type/:tmdbId   { watched?: boolean, rating?: "like" | "dislike" | null }
 *   GET /api/opinions/for-you         → { ready, library, explore }
 */
const router = Router();

router.get("/", requireAuth, (req, res, next) => {
  listOpinions(req.authUser!.userId)
    .then((opinions) => res.json({ opinions }))
    .catch(next);
});

router.get("/for-you", requireAuth, (req, res, next) => {
  forYou(req.authUser!.userId)
    .then((result) => res.json(result))
    .catch(next);
});

router.put("/:type/:tmdbId", requireAuth, (req, res, next) => {
  const { type, tmdbId } = req.params;
  if ((type !== "movie" && type !== "tv") || !isTmdbId(tmdbId)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const change = parseOpinionChange(req.body);
  if (!change) {
    res.status(400).json({ error: "Send watched (true or false), rating (like, dislike or null), or both" });
    return;
  }
  setOpinion(req.authUser!.userId, type, String(Number(tmdbId)), change)
    .then(() => res.json({ ok: true }))
    .catch(next);
});

export default router;
