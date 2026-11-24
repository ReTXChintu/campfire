import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { isTmdbId } from "../lib/explore";
import { findByTmdb, type TmdbRef } from "../lib/tmdbRef";
import { playTarget, seriesEpisodes } from "../lib/titlePlay";
import { trailerFor } from "../lib/trailer";

/**
 * Titles addressed by their TMDb id.
 *
 *   GET /api/title/:type/:tmdbId[?season=1&episode=2] → { kind, id } of the library item, or 404
 *   GET /api/title/tv/:tmdbId/episodes[?season=1]     → { seasons, season, episodes, resume }
 *   GET /api/title/:type/:tmdbId/play[?season&episode] → { href }
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

/** A series' seasons, one season's episodes with the viewer's progress, and where they'd carry on. */
router.get("/tv/:tmdbId/episodes", requireAuth, (req, res, next) => {
  const ref = parseRef("tv", req.params.tmdbId);
  const season = req.query.season === undefined ? null : Number(req.query.season);
  if (!ref || (season !== null && !Number.isInteger(season))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  seriesEpisodes(req.authUser!.userId, ref.id, season)
    .then((list) => (list ? res.json(list) : res.status(404).json({ error: "TMDb has no episodes for it, or isn't answering" })))
    .catch(next);
});

/** Where Play goes: { href } of the library's page for it, or of the title's own. */
router.get("/:type/:tmdbId/play", requireAuth, (req, res, next) => {
  const ref = parseRef(req.params.type, req.params.tmdbId);
  if (ref?.type === "tv" && (req.query.season !== undefined || req.query.episode !== undefined)) {
    ref.season = Number(req.query.season);
    ref.episode = Number(req.query.episode);
    if (!Number.isInteger(ref.season) || !Number.isInteger(ref.episode)) {
      res.status(400).json({ error: "season and episode go together" });
      return;
    }
  }
  if (!ref) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  playTarget(req.authUser!.userId, ref)
    .then((target) => (target ? res.json(target) : res.status(404).json({ error: "TMDb has no such title, or isn't answering" })))
    .catch(next);
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
