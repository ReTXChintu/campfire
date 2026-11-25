import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { listViewerSources } from "../lib/videoSources";

/** GET /api/sources → { sources: [{ id, name }] } — what a viewer can play from, in the admin's order. */
const router = Router();

router.get("/", requireAuth, (_req, res, next) => {
  listViewerSources()
    .then((sources) => res.json({ sources }))
    .catch(next);
});

export default router;
