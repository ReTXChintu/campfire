import { Router } from "express";
import { requireAdmin } from "../../middleware/auth";
import { getUserById } from "../../lib/users";
import { getCatalogVideo } from "../../lib/catalogVideos";
import { getCatalogFolder } from "../../lib/catalogFolders";
import {
  countByStatus,
  getRequest,
  isRequestStatus,
  listRequests,
  updateRequest,
  deleteRequest,
  type MediaRequest,
} from "../../lib/mediaRequests";
import { deleteRequestImage } from "../../lib/requestImages";

const router = Router();

/** The admin view of a request — everything the user-facing shape has, plus who asked, who else
 * wants it, and the title of whatever catalog item it was fulfilled with. */
async function toAdminRequest(doc: MediaRequest) {
  const requester = await getUserById(doc.requestedBy);
  const voters = await Promise.all(doc.upvotes.slice(0, 25).map((id) => getUserById(id)));

  let catalogTitle: string | null = null;
  if (doc.catalogRef) {
    const item =
      doc.catalogRef.kind === "video"
        ? await getCatalogVideo(doc.catalogRef.id)
        : await getCatalogFolder(doc.catalogRef.id);
    catalogTitle = item?.title ?? null;
  }

  return {
    id: doc._id,
    title: doc.title,
    type: doc.type,
    year: doc.year,
    refLink: doc.refLink,
    refImagePath: doc.refImageId ? `/api/request-image/${doc.refImageId}` : null,
    refMeta: doc.refMeta,
    requestedBy: { id: doc.requestedBy, name: requester?.name ?? doc.requestedByName, email: requester?.email ?? null },
    wantCount: doc.upvotes.length,
    voters: voters
      .filter((v): v is NonNullable<typeof v> => !!v)
      .map((v) => ({ id: v._id, name: v.name, email: v.email })),
    status: doc.status,
    adminNote: doc.adminNote,
    catalogRef: doc.catalogRef,
    catalogTitle,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    statusChangedAt: doc.statusChangedAt,
  };
}

router.get("/", requireAdmin, async (req, res) => {
  const statusParam = typeof req.query.status === "string" ? req.query.status : undefined;
  const status = statusParam && isRequestStatus(statusParam) ? statusParam : undefined;

  const [docs, counts] = await Promise.all([listRequests(status ? { status } : undefined), countByStatus()]);
  const requests = await Promise.all(docs.map(toAdminRequest));
  res.json({ requests, counts, total: Object.values(counts).reduce((sum, n) => sum + n, 0) });
});

/** Just the counts — cheap enough to poll for the sidebar's "N new" badge without pulling every
 * request and its user lookups along with it. */
router.get("/counts", requireAdmin, async (_req, res) => {
  res.json({ counts: await countByStatus() });
});

router.get("/:id", requireAdmin, async (req, res) => {
  const doc = await getRequest(req.params.id);
  if (!doc) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ request: await toAdminRequest(doc) });
});

router.patch("/:id", requireAdmin, async (req, res) => {
  const body = req.body ?? {};
  const patch: Parameters<typeof updateRequest>[1] = {};

  if (body.status !== undefined) {
    if (!isRequestStatus(body.status)) {
      res.status(400).json({ error: "Unknown status" });
      return;
    }
    patch.status = body.status;
  }
  if (body.adminNote !== undefined) {
    patch.adminNote = typeof body.adminNote === "string" && body.adminNote.trim() ? body.adminNote.trim() : null;
  }
  if (body.type !== undefined) {
    if (body.type !== null && body.type !== "movie" && body.type !== "series") {
      res.status(400).json({ error: "type must be 'movie', 'series' or null" });
      return;
    }
    patch.type = body.type;
  }
  if (body.year !== undefined) {
    patch.year = body.year === null ? null : Number(body.year) || null;
  }
  if (body.catalogRef !== undefined) {
    if (body.catalogRef === null) {
      patch.catalogRef = null;
    } else {
      const { kind, id } = body.catalogRef ?? {};
      if ((kind !== "video" && kind !== "folder") || typeof id !== "string" || !id) {
        res.status(400).json({ error: "catalogRef must be { kind: 'video' | 'folder', id }" });
        return;
      }
      // Verified rather than trusted: a dangling catalogRef would produce a spotlight slide whose
      // Play button goes nowhere (see routes/catalog.ts), which is worse than no slide at all.
      const exists = kind === "video" ? await getCatalogVideo(id) : await getCatalogFolder(id);
      if (!exists) {
        res.status(404).json({ error: "That catalog item doesn't exist" });
        return;
      }
      patch.catalogRef = { kind, id };
    }
  }

  // Declining is the one transition that owes the requester an explanation, so it's enforced here
  // rather than only in the UI — the mobile/desktop clients hit the same endpoint.
  const existing = await getRequest(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const nextStatus = patch.status ?? existing.status;
  const nextNote = patch.adminNote !== undefined ? patch.adminNote : existing.adminNote;
  if (nextStatus === "declined" && !nextNote) {
    res.status(400).json({ error: "Say why it's being declined — the requester sees this note", field: "adminNote" });
    return;
  }
  if (nextStatus === "added" && !(patch.catalogRef ?? existing.catalogRef)) {
    res.status(400).json({ error: "Link the catalog item this request was fulfilled with", field: "catalogRef" });
    return;
  }

  const doc = await updateRequest(req.params.id, patch);
  if (!doc) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ request: await toAdminRequest(doc) });
});

/** Bulk status change from the list's multi-select. Statuses that would need a per-request note or
 * catalog link ('declined' / 'added') are refused in bulk — those are one-at-a-time decisions. */
router.post("/bulk-status", requireAdmin, async (req, res) => {
  const ids: unknown = req.body?.ids;
  const status: unknown = req.body?.status;

  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string") || ids.length === 0) {
    res.status(400).json({ error: "ids must be a non-empty array of request ids" });
    return;
  }
  if (!isRequestStatus(status)) {
    res.status(400).json({ error: "Unknown status" });
    return;
  }
  if (status === "declined" || status === "added") {
    res.status(400).json({
      error: `"${status}" needs a note or a catalog link, so it has to be set one request at a time`,
    });
    return;
  }

  const updated = await Promise.all((ids as string[]).map((id) => updateRequest(id, { status })));
  res.json({ updated: updated.filter(Boolean).length, counts: await countByStatus() });
});

router.delete("/:id", requireAdmin, async (req, res) => {
  const doc = await deleteRequest(req.params.id);
  if (!doc) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (doc.refImageId) await deleteRequestImage(doc.refImageId);
  res.json({ ok: true });
});

export default router;
