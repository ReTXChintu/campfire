import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { isTmdbId } from "../lib/explore";
import { findByTmdb, type TmdbRef } from "../lib/tmdbRef";
import { trailerFor } from "../lib/trailer";

/**
 * Titles addressed by their TMDb id.
 *
 *   GET /api/title/:type/:tmdbId[?season=1&episode=2] → { kind, id } of the library item, or 404
 *   GET /api/title/:type/:tmdbId/trailer              → { trailer: { name, youtubeId } | null }
 */
const router = Router();

function parseRef(type: string, tmdbId: string): TmdbRef | null {
  if ((type !== "movie" && type !== "tv") || !isTmdbId(tmdbId)) return null;
  return { type, id: tmdbId };
}

router.get("/:type/:tmdbId", requireAuth, async (req, res) => {
  const ref = parseRef(req.params.type, req.params.tmdbId);
  if (ref?.type === "tv" && (req.query.season !== undefined || req.query.episode !== undefined)) {
    const season = Number(req.query.season);
    const episode = Number(req.query.episode);
    if (!Number.isInteger(season) || !Number.isInteger(episode)) {
      res.status(400).json({ error: "season and episode go together" });
      return;
    }
    ref.season = season;
    ref.episode = episode;
  }
  const found = ref ? await findByTmdb(ref) : null;
  if (!found) {
    res.status(404).json({ error: "That title isn't in the library" });
    return;
  }
  res.json(found);
});

router.get("/:type/:tmdbId/trailer", requireAuth, async (req, res) => {
  const ref = parseRef(req.params.type, req.params.tmdbId);
  if (!ref) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.setHeader("cache-control", "private, max-age=3600");
  res.json({ trailer: await trailerFor(ref.type, ref.id) });
});

export default router;
