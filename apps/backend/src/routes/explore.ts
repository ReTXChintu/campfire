import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { isTmdbSearchAvailable } from "../lib/tmdbSearch";
import {
  exploreDetail,
  explorePage,
  exploreWall,
  isTmdbId,
  parseExploreKind,
  parseExploreServices,
  similarTitles,
} from "../lib/explore";

/** Explore (lib/explore.ts): every film and series on TMDb, with where each streams in India. */
const router = Router();

/** `?kind=all|movie|tv&services=8,119`. `available: false` when the server has no TMDb key — the
 * page then says so instead of showing empty rows. */
router.get("/", requireAuth, async (req, res) => {
  if (!isTmdbSearchAvailable()) {
    res.json({ available: false, rows: [], services: [], featured: null });
    return;
  }
  const page = await explorePage(parseExploreKind(req.query.kind), parseExploreServices(req.query.services), req.authUser!.userId);
  if (!page) {
    res.status(502).json({ error: "TMDb isn't answering right now — try again in a minute" });
    return;
  }
  res.json({ available: true, ...page });
});

/** The fisheye wall: up to 900 posters, most interesting first (the client lays them out from
 * the middle outwards). Same filters as the rows. */
router.get("/wall", requireAuth, async (req, res) => {
  if (!isTmdbSearchAvailable()) {
    res.json({ available: false, items: [], services: [], imageBase: null });
    return;
  }
  const wall = await exploreWall(parseExploreKind(req.query.kind), parseExploreServices(req.query.services));
  if (!wall) {
    res.status(502).json({ error: "TMDb isn't answering right now — try again in a minute" });
    return;
  }
  res.json({ available: true, ...wall });
});

router.get("/title/:type/:tmdbId", requireAuth, async (req, res) => {
  const { type, tmdbId } = req.params;
  if (type !== "movie" && type !== "tv") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!isTmdbSearchAvailable()) {
    res.status(404).json({ error: "Explore isn't set up on this server" });
    return;
  }
  const detail = await exploreDetail(type, tmdbId, req.authUser!.userId);
  if (!detail) {
    res.status(404).json({ error: "TMDb has no such title, or isn't answering right now" });
    return;
  }
  res.json({ title: detail });
});

router.get("/title/:type/:tmdbId/similar", requireAuth, (req, res, next) => {
  const { type, tmdbId } = req.params;
  if ((type !== "movie" && type !== "tv") || !isTmdbId(tmdbId)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  similarTitles(type, tmdbId)
    .then((items) => res.json({ items }))
    .catch(next);
});

export default router;
