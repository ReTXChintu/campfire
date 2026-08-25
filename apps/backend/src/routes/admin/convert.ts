import { Router } from "express";
import { requireAdmin } from "../../middleware/auth";
import { createJobs, type ConvertItem } from "../../lib/uploadJobs";

const router = Router();

// Enqueues one or more locally-staged files (see /api/admin/stage) for conversion to a
// browser-native MP4 — entirely on this machine, no Drive involved. The actual ffmpeg work happens
// in lib/conversionQueue.ts's background runner, strictly one file at a time; this route just
// records the jobs and returns immediately so the admin can queue a whole batch and walk away. The
// admin downloads each result as it finishes and uploads it to Drive by hand; this never writes to
// Drive itself (that path is what hit "Service Accounts do not have storage quota" — service
// accounts have no storage of their own outside a shared drive).
router.post("/", requireAdmin, async (req, res) => {
  const { items } = req.body as { items?: ConvertItem[] };
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: "items must be a non-empty array" });
    return;
  }
  for (const item of items) {
    if (!item.stagingId || !item.title || item.audioIndex == null) {
      res.status(400).json({ error: "each item requires stagingId, title, and audioIndex" });
      return;
    }
  }

  const { batchId, jobIds } = await createJobs(items, req.authUser!.email);
  res.json({ batchId, jobIds });
});

export default router;
