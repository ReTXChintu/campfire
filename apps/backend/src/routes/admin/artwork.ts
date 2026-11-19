import { Router, type Response } from "express";
import { requireAdmin } from "../../middleware/auth";
import {
  ArtworkLookupError,
  clearArtwork,
  matchArtworkNow,
  setArtworkFromLink,
  useTmdbTitle,
  useTmdbTitlesEverywhere,
  type ArtworkKind,
} from "../../lib/artwork";
import {
  matchCatalog,
  matchEpisodesForSeries,
  publishNamedEpisodes,
  setEpisodeArtworkEnabled,
  setFolderSeason,
} from "../../lib/episodeArtwork";

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

/** Match every movie and series that still has no artwork, retrying earlier misses, then name
 * every episode underneath the ones that matched. */
router.post("/auto-match", requireAdmin, async (_req, res) => {
  const result = await matchCatalog({ retry: true });
  if (result.skipped === "no-key") {
    res.status(503).json({ error: "TMDB_API_KEY isn't set on the server", code: "no-key" });
    return;
  }
  res.json(result);
});

/** Rename every matched movie and series to the title TMDb uses. Unlike the rename a match does
 * on its own, this overwrites hand-typed names — it only runs when an admin asks for it. */
router.post("/use-tmdb-titles", requireAdmin, async (_req, res) => {
  res.json({ renamed: await useTmdbTitlesEverywhere() });
});

/** Rename this one title to TMDb's. */
router.post("/:kind/:id/use-tmdb-title", requireAdmin, async (req, res) => {
  const kind = parseKind(req.params.kind);
  if (!kind) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  try {
    res.json(await useTmdbTitle(kind, req.params.id));
  } catch (error) {
    sendError(res, error);
  }
});

/** Name this one series' episodes from TMDb now. Body `{ force: true }` also replaces episode
 * titles an admin typed by hand, which the ordinary pass deliberately leaves alone. */
router.post("/folder/:id/episodes", requireAdmin, async (req, res) => {
  try {
    res.json(await matchEpisodesForSeries(req.params.id, { force: req.body?.force === true }));
  } catch (error) {
    sendError(res, error);
  }
});

/** Publish the never-curated episodes of a series that TMDb has named. Body `{ dryRun: true }`
 * returns what would happen without writing anything — the admin screens always preview first. */
router.post("/folder/:id/publish-episodes", requireAdmin, async (req, res) => {
  try {
    res.json(
      await publishNamedEpisodes(req.params.id, {
        dryRun: req.body?.dryRun !== false,
        curatedBy: req.authUser!.email,
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
});

/** Body `{ season }` (a number, or null to go back to guessing from the folder's name): which
 * season of its series this folder holds. Re-matches the series' episodes straight away. */
router.put("/folder/:id/season", requireAdmin, async (req, res) => {
  const raw = req.body?.season;
  const season = raw == null || raw === "" ? null : Number(raw);
  if (season != null && (!Number.isInteger(season) || season < 0 || season > 99)) {
    res.status(400).json({ error: "season must be a whole number from 0 to 99, or empty" });
    return;
  }
  try {
    res.json(await setFolderSeason(req.params.id, season));
  } catch (error) {
    sendError(res, error);
  }
});

/** Body `{ enabled }`: whether this series' episodes take their names from TMDb. */
router.put("/folder/:id/episode-naming", requireAdmin, async (req, res) => {
  if (typeof req.body?.enabled !== "boolean") {
    res.status(400).json({ error: "enabled must be true or false" });
    return;
  }
  try {
    await setEpisodeArtworkEnabled(req.params.id, req.body.enabled);
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
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
