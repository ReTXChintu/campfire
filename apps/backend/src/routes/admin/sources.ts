import { Router, type Request, type Response } from "express";
import { requireAdmin } from "../../middleware/auth";
import { getCatalogVideo } from "../../lib/catalogVideos";
import { HostError } from "../../lib/videoHosts";
import {
  addFrameVideos,
  createSource,
  deleteSource,
  FEATURES,
  linkVideo,
  listSources,
  listSourceVideos,
  previewFrame,
  removeFrameVideo,
  setOrder,
  SourceInputError,
  syncSource,
  updateSource,
} from "../../lib/videoSources";

/** The admin Sources page (lib/videoSources.ts). Keys go in and never come back out. */
const router = Router();

/** Answers the two errors an admin can do something about; anything else is a 500. */
function handle(action: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    action(req, res).catch((error) => {
      if (error instanceof SourceInputError || error instanceof HostError) {
        res.status(400).json({ error: error.message });
        return;
      }
      console.error("[sources]", error);
      res.status(500).json({ error: "Internal server error" });
    });
  };
}

const notFound = (res: Response) => res.status(404).json({ error: "Not found" });

router.get("/", requireAdmin, handle(async (_req, res) => {
  res.json({ features: FEATURES, sources: await listSources() });
}));

router.post("/", requireAdmin, handle(async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  res.status(201).json({ id: await createSource(body.kind, body) });
}));

/** What a pasted embed code is read as; nothing is saved. */
router.post("/read-code", requireAdmin, handle(async (req, res) => {
  res.json(previewFrame((req.body as { code?: unknown })?.code));
}));

router.put("/order", requireAdmin, handle(async (req, res) => {
  const ids = (req.body as { ids?: unknown })?.ids;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
    res.status(400).json({ error: "ids must be a list" });
    return;
  }
  await setOrder(ids);
  res.json({ ok: true });
}));

router.patch("/:id", requireAdmin, handle(async (req, res) => {
  if (await updateSource(req.params.id, (req.body ?? {}) as Record<string, unknown>)) res.json({ ok: true });
  else notFound(res);
}));

router.delete("/:id", requireAdmin, handle(async (req, res) => {
  if (await deleteSource(req.params.id)) res.json({ ok: true });
  else notFound(res);
}));

router.post("/:id/sync", requireAdmin, handle(async (req, res) => {
  if (await syncSource(req.params.id)) res.json({ ok: true });
  else notFound(res);
}));

router.get("/:id/videos", requireAdmin, handle(async (req, res) => {
  res.json({ videos: await listSourceVideos(req.params.id) });
}));

/** An "any player" source's videos, one per line: the id on that site, then an optional name. */
router.post("/:id/videos", requireAdmin, handle(async (req, res) => {
  const added = await addFrameVideos(req.params.id, (req.body as { lines?: unknown })?.lines);
  if (added === null) notFound(res);
  else res.status(201).json({ added });
}));

router.delete("/:id/videos/:videoId", requireAdmin, handle(async (req, res) => {
  if (await removeFrameVideo(req.params.id, req.params.videoId)) res.json({ ok: true });
  else notFound(res);
}));

/** `fileId` links the video to that catalog video's title; null goes back to matching by name. */
router.put("/:id/videos/:videoId", requireAdmin, handle(async (req, res) => {
  const fileId = (req.body as { fileId?: unknown })?.fileId;
  const video = typeof fileId === "string" ? await getCatalogVideo(fileId) : null;
  if (fileId !== null && !video) {
    notFound(res);
    return;
  }
  if (await linkVideo(req.params.id, req.params.videoId, video)) res.json({ ok: true });
  else notFound(res);
}));

export default router;
