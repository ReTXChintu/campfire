import { Router } from "express";
import { getProgress, upsertProgress } from "../lib/progress";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const fileId = typeof req.query.fileId === "string" ? req.query.fileId : null;
  if (!fileId) {
    res.status(400).json({ error: "fileId is required" });
    return;
  }

  const progress = await getProgress(req.authUser!.userId, fileId);
  res.json({ progress });
});

router.post("/", requireAuth, async (req, res) => {
  const { fileId, parentFolderId, positionSeconds, durationSeconds } = req.body as {
    fileId?: string;
    parentFolderId?: string;
    positionSeconds?: number;
    durationSeconds?: number;
  };

  if (
    !fileId ||
    !parentFolderId ||
    typeof positionSeconds !== "number" ||
    typeof durationSeconds !== "number"
  ) {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }

  await upsertProgress({
    userId: req.authUser!.userId,
    fileId,
    parentFolderId,
    positionSeconds,
    durationSeconds,
  });

  res.json({ ok: true });
});

export default router;
