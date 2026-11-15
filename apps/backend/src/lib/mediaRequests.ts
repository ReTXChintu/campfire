import { randomUUID } from "node:crypto";
import { getDb } from "./mongodb";

/** The admin's workflow, in order. `declined` is a terminal branch off any of the others. */
export const REQUEST_STATUSES = ["new", "planned", "sourcing", "added", "declined"] as const;
export type MediaRequestStatus = (typeof REQUEST_STATUSES)[number];

export function isRequestStatus(value: unknown): value is MediaRequestStatus {
  return typeof value === "string" && (REQUEST_STATUSES as readonly string[]).includes(value);
}

/** Movie vs series is never asked of the requester (the form is title + one reference, nothing
 * else) — it's filled in from the reference lookup when there is one, and is otherwise the
 * admin's to set from the request detail panel. Null means "nobody has said yet". */
export type MediaRequestType = "movie" | "series";

export type ReferenceMeta = {
  source: "tmdb";
  sourceId: string;
  title: string;
  year: number | null;
  type: MediaRequestType | null;
  posterUrl: string | null;
  overview: string | null;
};

export type CatalogRef = { kind: "video" | "folder"; id: string };

export type MediaRequest = {
  _id: string;
  title: string;
  /** Lowercased/punctuation-stripped `title`, stored so the dedupe check is an index hit rather
   * than a regex scan over every request. */
  titleKey: string;
  refLink: string | null;
  /** Id of an uploaded reference image on disk — see lib/requestImages.ts. */
  refImageId: string | null;
  /** Populated from `refLink` when TMDB_API_KEY is configured; always null otherwise, and the
   * request is still perfectly usable — the admin just opens the link themselves. */
  refMeta: ReferenceMeta | null;
  type: MediaRequestType | null;
  year: number | null;
  requestedBy: string;
  /** Denormalised at write time so the board doesn't need a user lookup per row. */
  requestedByName: string | null;
  /** User ids, requester included — so `upvotes.length` is "how many people want this". */
  upvotes: string[];
  status: MediaRequestStatus;
  adminNote: string | null;
  /** Set when the admin links a fulfilled request to the thing they actually published; this is
   * what turns the request into a Home-spotlight slide (see routes/catalog.ts). */
  catalogRef: CatalogRef | null;
  createdAt: Date;
  updatedAt: Date;
  /** When `status` last changed — orders the "now available" spotlight slides. */
  statusChangedAt: Date;
};

async function collection() {
  const db = await getDb();
  return db.collection<MediaRequest>("mediaRequests");
}

export async function ensureIndexes(): Promise<void> {
  const col = await collection();
  await Promise.all([
    col.createIndex({ status: 1, createdAt: -1 }),
    col.createIndex({ titleKey: 1 }),
    col.createIndex({ requestedBy: 1, createdAt: -1 }),
    // Drives the fulfilled-request spotlight slides.
    col.createIndex({ status: 1, statusChangedAt: -1 }),
  ]);
}

/** Collapses the spellings people actually type ("The Matrix", "matrix!", "THE  MATRIX") onto one
 * key, so the form can warn "N others already asked" instead of collecting five copies. Leading
 * articles are dropped deliberately — "The Office" and "Office" are the same ask here. */
export function titleKeyOf(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/^(the|a|an)\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function createRequest(input: {
  title: string;
  refLink: string | null;
  refImageId: string | null;
  refMeta: ReferenceMeta | null;
  requestedBy: string;
  requestedByName: string | null;
}): Promise<MediaRequest> {
  const now = new Date();
  const doc: MediaRequest = {
    _id: randomUUID(),
    title: input.title,
    titleKey: titleKeyOf(input.title),
    refLink: input.refLink,
    refImageId: input.refImageId,
    refMeta: input.refMeta,
    type: input.refMeta?.type ?? null,
    year: input.refMeta?.year ?? null,
    requestedBy: input.requestedBy,
    requestedByName: input.requestedByName,
    // The requester implicitly wants it — otherwise every new request would read "0 people want
    // this" next to the person who just asked for it.
    upvotes: [input.requestedBy],
    status: "new",
    adminNote: null,
    catalogRef: null,
    createdAt: now,
    updatedAt: now,
    statusChangedAt: now,
  };
  const col = await collection();
  await col.insertOne(doc);
  return doc;
}

export async function getRequest(id: string): Promise<MediaRequest | null> {
  const col = await collection();
  return col.findOne({ _id: id });
}

/** Open requests matching a title, for the form's "already asked" dedupe hint. Declined and added
 * ones are excluded on purpose: if it was declined, asking again is legitimate, and if it was
 * added it's in the library and the library-match warning covers it. */
export async function findOpenRequestsByTitle(title: string): Promise<MediaRequest[]> {
  const col = await collection();
  return col.find({ titleKey: titleKeyOf(title), status: { $in: ["new", "planned", "sourcing"] } }).toArray();
}

export async function listRequests(filter?: { status?: MediaRequestStatus }): Promise<MediaRequest[]> {
  const col = await collection();
  return col
    .find(filter?.status ? { status: filter.status } : {})
    .sort({ createdAt: -1 })
    .toArray();
}

export async function listRequestsByUser(userId: string): Promise<MediaRequest[]> {
  const col = await collection();
  return col.find({ requestedBy: userId }).sort({ createdAt: -1 }).toArray();
}

/** Fulfilled requests, newest first — the source of the Home spotlight's "now available" slides. */
export async function listRecentlyFulfilled(limit: number): Promise<MediaRequest[]> {
  const col = await collection();
  return col
    .find({ status: "added", catalogRef: { $ne: null } })
    .sort({ statusChangedAt: -1 })
    .limit(limit)
    .toArray();
}

export async function countByStatus(): Promise<Record<MediaRequestStatus, number>> {
  const col = await collection();
  const rows = await col.aggregate<{ _id: MediaRequestStatus; count: number }>([
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]).toArray();
  const counts = { new: 0, planned: 0, sourcing: 0, added: 0, declined: 0 };
  for (const row of rows) if (isRequestStatus(row._id)) counts[row._id] = row.count;
  return counts;
}

/** Idempotent per user — calling it twice leaves one vote, so a double tap on a phone can't
 * inflate the count. Returns the request as it now stands, or null if it's gone. */
export async function toggleUpvote(id: string, userId: string, wantsIt: boolean): Promise<MediaRequest | null> {
  const col = await collection();
  const res = await col.findOneAndUpdate(
    { _id: id },
    {
      ...(wantsIt ? { $addToSet: { upvotes: userId } } : { $pull: { upvotes: userId } }),
      $set: { updatedAt: new Date() },
    },
    { returnDocument: "after" },
  );
  return res ?? null;
}

export async function updateRequest(
  id: string,
  patch: {
    status?: MediaRequestStatus;
    adminNote?: string | null;
    catalogRef?: CatalogRef | null;
    type?: MediaRequestType | null;
    year?: number | null;
  },
): Promise<MediaRequest | null> {
  const col = await collection();
  const existing = await col.findOne({ _id: id });
  if (!existing) return null;

  const now = new Date();
  const $set: Partial<MediaRequest> = { updatedAt: now };
  if (patch.status !== undefined) {
    $set.status = patch.status;
    if (patch.status !== existing.status) $set.statusChangedAt = now;
  }
  if (patch.adminNote !== undefined) $set.adminNote = patch.adminNote;
  if (patch.catalogRef !== undefined) $set.catalogRef = patch.catalogRef;
  if (patch.type !== undefined) $set.type = patch.type;
  if (patch.year !== undefined) $set.year = patch.year;

  const res = await col.findOneAndUpdate({ _id: id }, { $set }, { returnDocument: "after" });
  return res ?? null;
}

export async function deleteRequest(id: string): Promise<MediaRequest | null> {
  const col = await collection();
  const res = await col.findOneAndDelete({ _id: id });
  return res ?? null;
}
