import { Router, type Response } from "express";
import { requireAdmin } from "../../middleware/auth";
import {
  ArtworkLookupError,
  autoMatchArtwork,
  clearArtwork,
  matchArtworkNow,
  setArtworkFromLink,
  type ArtworkKind,
} from "../../lib/artwork";

/** Artwork curation for a movie or series (see lib/artwork.ts). Mounted at
 * /api/admin/catalog/artwork; web and the Windows app's admin screens both use it. */
const router = Router();

function parseKind(value: string): ArtworkKind | null {
  return value === "folder" || value === "video" ? value : null;
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof ArtworkLookupError) {
    const status = error.code === "missing" ? 404 : error.code === "no-key" ? 503 : 400;
    res.status(status).json({ error: error.message, code: error.code });
    return;
  }
  throw error;
}

/** Match every movie and series that still has no artwork, retrying earlier misses. */
router.post("/auto-match", requireAdmin, async (_req, res) => {
  const result = await autoMatchArtwork({ retry: true });
  if (result.skipped === "no-key") {
    res.status(503).json({ error: "TMDB_API_KEY isn't set on the server", code: "no-key" });
    return;
  }
  res.json(result);
});

/** Body `{ link }`: an IMDb or TMDb link that becomes this title's artwork. */
router.put("/:kind/:id", requireAdmin, async (req, res) => {
  const kind = parseKind(req.params.kind);
  const link = typeof req.body?.link === "string" ? req.body.link.trim() : "";
  if (!kind) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!link) {
    res.status(400).json({ error: "link is required", code: "bad-link" });
    return;
  }
  try {
    res.json({ artwork: await setArtworkFromLink(kind, req.params.id, link) });
  } catch (error) {
    sendError(res, error);
  }
});

/** Search TMDb for this one title now. */
router.post("/:kind/:id/auto", requireAdmin, async (req, res) => {
  const kind = parseKind(req.params.kind);
  if (!kind) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  try {
    res.json({ artwork: await matchArtworkNow(kind, req.params.id) });
  } catch (error) {
    sendError(res, error);
  }
});

/** Remove the artwork and stop matching this title automatically. */
router.delete("/:kind/:id", requireAdmin, async (req, res) => {
  const kind = parseKind(req.params.kind);
  if (!kind) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  try {
    await clearArtwork(kind, req.params.id);
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
