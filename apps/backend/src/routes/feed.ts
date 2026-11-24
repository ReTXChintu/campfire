import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { parseExploreKind } from "../lib/explore";
import { feedPage, feedSection } from "../lib/feed";
import { isTmdbSearchAvailable } from "../lib/tmdbSearch";

/**
 * Home's feed (lib/feed.ts).
 *
 *   GET /api/feed?kind=all|movie|tv&page=0          → { available, hero, sections, next }
 *   GET /api/feed/section/:id?kind=…&page=1         → { title, items, next }
 */
const router = Router();

const NOT_ANSWERING = "TMDb isn't answering right now — try again in a minute";
const pageOf = (value: unknown, first: number) => {
  const page = Number(value ?? first);
  return Number.isInteger(page) && page >= first && page <= 500 ? page : null;
};

router.get("/", requireAuth, (req, res, next) => {
  if (!isTmdbSearchAvailable()) {
    res.json({ available: false, hero: [], sections: [], next: null });
    return;
  }
  const page = pageOf(req.query.page, 0);
  if (page === null) {
    res.status(400).json({ error: "Bad page" });
    return;
  }
  feedPage(parseExploreKind(req.query.kind), page)
    .then((feed) => (feed ? res.json({ available: true, ...feed }) : res.status(502).json({ error: NOT_ANSWERING })))
    .catch(next);
});

router.get("/section/:id", requireAuth, (req, res, next) => {
  const page = pageOf(req.query.page, 1);
  if (page === null || !isTmdbSearchAvailable()) {
    res.status(page === null ? 400 : 404).json({ error: page === null ? "Bad page" : "Not found" });
    return;
  }
  feedSection(parseExploreKind(req.query.kind), req.params.id, page)
    .then((section) => {
      if (section) res.json(section);
      else res.status(section === undefined ? 404 : 502).json({ error: section === undefined ? "Not found" : NOT_ANSWERING });
    })
    .catch(next);
});

export default router;
