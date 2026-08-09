import { Router } from "express";
import { requireAdmin } from "../../middleware/auth";
import { getSubtitleSet } from "../../lib/subtitleSets";
import { languageName } from "../../lib/languageNames";

const router = Router();

router.get("/:subtitleSetId/download/:trackIndex", requireAdmin, async (req, res) => {
  const { subtitleSetId, trackIndex } = req.params;
  const index = Number(trackIndex);

  const set = await getSubtitleSet(subtitleSetId).catch(() => null);
  const track = set?.subtitles.find((s) => s.index === index);
  if (!track || !set) {
    res.status(404).json({ error: "Subtitle track not found" });
    return;
  }

  const label = (track.language ? languageName(track.language) : null) ?? track.title ?? `track-${track.index}`;
  const filename = `${set.sourceLabel} - ${label}.vtt`.replace(/[\\/]/g, "-");

  res.setHeader("Content-Type", "text/vtt");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
  res.send(track.vtt);
});

export default router;
