import { Router } from "express";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { requireAuth } from "../middleware/auth";
import { isAdminEmail } from "../lib/admin";
import { getUserById } from "../lib/users";
import {
  createRequest,
  findOpenRequestsByTitle,
  getRequest,
  listRequests,
  listRequestsByUser,
  toggleUpvote,
  deleteRequest,
  type MediaRequest,
} from "../lib/mediaRequests";
import {
  isValidImageId,
  mimeForImageId,
  requestImagePath,
  saveRequestImage,
  deleteRequestImage,
  isAllowedImageMime,
  ImageTooLargeError,
  MAX_REQUEST_IMAGE_BYTES,
} from "../lib/requestImages";
import { isSupportedReferenceLink, resolveReferenceLink } from "../lib/referenceLink";

const router = Router();

const MAX_TITLE_LENGTH = 200;

/** What a viewer is allowed to see about someone else's request. Deliberately excludes the raw
 * upvoter id list — the board shows a count and whether *you* voted, not who else did. */
export function toPublicRequest(doc: MediaRequest, viewerId: string) {
  return {
    id: doc._id,
    title: doc.title,
    type: doc.type,
    year: doc.year,
    refLink: doc.refLink,
    refImagePath: doc.refImageId ? `/api/request-image/${doc.refImageId}` : null,
    refMeta: doc.refMeta,
    requestedByName: doc.requestedByName,
    isMine: doc.requestedBy === viewerId,
    wantCount: doc.upvotes.length,
    iWantIt: doc.upvotes.includes(viewerId),
    status: doc.status,
    adminNote: doc.adminNote,
    catalogRef: doc.catalogRef,
    createdAt: doc.createdAt,
    statusChangedAt: doc.statusChangedAt,
  };
}

/** The whole board. Everyone sees everyone's requests — that's what makes "N people want this"
 * mean anything, and it's what stops five people asking for the same film. */
router.get("/", requireAuth, async (req, res) => {
  const viewerId = req.authUser!.userId;
  const docs = await listRequests();
  res.json({ requests: docs.map((doc) => toPublicRequest(doc, viewerId)) });
});

router.get("/mine", requireAuth, async (req, res) => {
  const viewerId = req.authUser!.userId;
  const docs = await listRequestsByUser(viewerId);
  res.json({ requests: docs.map((doc) => toPublicRequest(doc, viewerId)) });
});

/** Powers the form's dedupe hint ("N others already asked — add my vote instead"). Returns the
 * single best open match rather than a list; the form only ever offers one. */
router.get("/match", requireAuth, async (req, res) => {
  const title = typeof req.query.title === "string" ? req.query.title : "";
  if (title.trim().length < 2) {
    res.json({ match: null });
    return;
  }
  const open = await findOpenRequestsByTitle(title);
  const best = open.sort((a, b) => b.upvotes.length - a.upvotes.length)[0];
  res.json({ match: best ? toPublicRequest(best, req.authUser!.userId) : null });
});

/** Validates a pasted link and, when TMDB_API_KEY is set, hands back the preview card's contents
 * so the requester can confirm it's the right title before submitting. Without the key this still
 * answers ok/not-ok, which is the part that actually matters. */
router.post("/resolve-link", requireAuth, async (req, res) => {
  const link = typeof req.body?.link === "string" ? req.body.link : "";
  const resolved = await resolveReferenceLink(link);
  if (!resolved) {
    res.status(400).json({
      error: "That doesn't look like an IMDb or TMDb title link",
      code: "unsupported_link",
    });
    return;
  }
  res.json({ ok: true, source: resolved.parsed.source, meta: resolved.meta });
});

/** Raw-body image upload, same shape as the admin stage route (no multipart parser in this
 * codebase): the client PUTs the bytes with the real Content-Type. Returns an id the submit call
 * then references, so an abandoned form costs one orphaned file, not a half-written request. */
router.post("/reference-image", requireAuth, async (req, res) => {
  const mimeType = (req.headers["content-type"] || "").toString();
  if (!isAllowedImageMime(mimeType)) {
    res.status(415).json({ error: "Attach a PNG, JPEG, WebP or GIF image" });
    return;
  }

  // Refuse on the declared length *before* reading a byte. Destroying the request stream
  // mid-upload (the backstop inside saveRequestImage) resets the connection, and the client sees
  // a network error instead of this message — so the size limit has to be answered up front for
  // anything that declares one, which every real client does.
  const declaredLength = Number(req.headers["content-length"] ?? NaN);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_IMAGE_BYTES) {
    res.status(413).json({
      error: `Reference image is larger than ${Math.round(MAX_REQUEST_IMAGE_BYTES / 1024 / 1024)}MB`,
      maxBytes: MAX_REQUEST_IMAGE_BYTES,
    });
    return;
  }

  try {
    const { imageId, sizeBytes } = await saveRequestImage(req, mimeType);
    res.json({ imageId, sizeBytes, path: `/api/request-image/${imageId}` });
  } catch (error) {
    if (error instanceof ImageTooLargeError) {
      res.status(413).json({ error: error.message, maxBytes: MAX_REQUEST_IMAGE_BYTES });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : "Upload failed" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const refLinkRaw = typeof req.body?.refLink === "string" ? req.body.refLink.trim() : "";
  const refImageId = typeof req.body?.refImageId === "string" ? req.body.refImageId : "";

  if (!title) {
    res.status(400).json({ error: "A title is required", field: "title" });
    return;
  }
  if (title.length > MAX_TITLE_LENGTH) {
    res.status(400).json({ error: `Keep the title under ${MAX_TITLE_LENGTH} characters`, field: "title" });
    return;
  }
  // Required-one-of: the whole point of the reference is that the admin can tell which release is
  // meant, so a request with neither is rejected rather than quietly accepted.
  if (!refLinkRaw && !refImageId) {
    res.status(400).json({ error: "Add an IMDb/TMDb link or an image so we know which one you mean", field: "reference" });
    return;
  }
  if (refLinkRaw && !isSupportedReferenceLink(refLinkRaw)) {
    res.status(400).json({ error: "That doesn't look like an IMDb or TMDb title link", field: "refLink" });
    return;
  }
  if (refImageId && !isValidImageId(refImageId)) {
    res.status(400).json({ error: "That image upload is no longer available — attach it again", field: "refImage" });
    return;
  }

  const resolved = refLinkRaw ? await resolveReferenceLink(refLinkRaw) : null;
  const user = await getUserById(req.authUser!.userId);

  const doc = await createRequest({
    title,
    refLink: refLinkRaw || null,
    refImageId: refImageId || null,
    refMeta: resolved?.meta ?? null,
    requestedBy: req.authUser!.userId,
    requestedByName: user?.name || req.authUser!.email.split("@")[0],
  });

  res.status(201).json({ request: toPublicRequest(doc, req.authUser!.userId) });
});

router.post("/:id/upvote", requireAuth, async (req, res) => {
  const wantsIt = req.body?.wantsIt !== false;
  const doc = await toggleUpvote(req.params.id, req.authUser!.userId, wantsIt);
  if (!doc) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ request: toPublicRequest(doc, req.authUser!.userId) });
});

/** A requester can withdraw their own request while it's still open; the admin can remove any.
 * An already-added request stays put — it's what a spotlight slide points at. */
router.delete("/:id", requireAuth, async (req, res) => {
  const doc = await getRequest(req.params.id);
  if (!doc) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const isOwner = doc.requestedBy === req.authUser!.userId;
  const isAdmin = isAdminEmail(req.authUser!.email);
  if (!isOwner && !isAdmin) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (doc.status === "added" && !isAdmin) {
    res.status(409).json({ error: "This one's already in the library" });
    return;
  }

  await deleteRequest(doc._id);
  if (doc.refImageId) await deleteRequestImage(doc.refImageId);
  res.json({ ok: true });
});

/** Serves a reference image to any signed-in user. Plain Bearer auth is enough here, unlike the
 * video streams: Flutter's Image.network sends headers on every platform, and the web app fetches
 * images through useAuthedImage rather than a bare <img src>. */
export const requestImageRouter = Router();

requestImageRouter.get("/:imageId", requireAuth, async (req, res) => {
  const { imageId } = req.params;
  if (!isValidImageId(imageId)) {
    res.status(400).json({ error: "Invalid image id" });
    return;
  }

  const filePath = requestImagePath(imageId);
  const stats = await stat(filePath).catch(() => null);
  if (!stats) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.setHeader("Content-Type", mimeForImageId(imageId));
  res.setHeader("Content-Length", stats.size);
  res.setHeader("Cache-Control", "private, max-age=86400");
  createReadStream(filePath).pipe(res);
});

export default router;
