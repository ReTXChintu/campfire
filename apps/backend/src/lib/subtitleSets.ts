import { ObjectId } from "mongodb";
import { getDb } from "./mongodb";
import type { ConvertedSubtitle } from "./drive";

export type SubtitleSet = {
  _id: ObjectId;
  sourceLabel: string; // the title typed into the Converter form (or the video's title, for a direct upload)
  subtitles: ConvertedSubtitle[];
  jobId: string; // uploadJobs.jobId, or "manual-upload" for a subtitle uploaded directly during curation
  createdAt: Date;
  createdBy: string;
  linkedVideoId: string | null; // catalogVideos._id once attached — a set links to at most one video
  linkedAt: Date | null;
};

async function collection() {
  const db = await getDb();
  return db.collection<SubtitleSet>("subtitleSets");
}

export async function ensureIndexes() {
  const col = await collection();
  await col.createIndex({ linkedVideoId: 1 });
}

export async function createSubtitleSet(input: {
  sourceLabel: string;
  subtitles: ConvertedSubtitle[];
  jobId: string;
  createdBy: string;
}): Promise<string> {
  const col = await collection();
  const res = await col.insertOne({
    _id: new ObjectId(),
    sourceLabel: input.sourceLabel,
    subtitles: input.subtitles,
    jobId: input.jobId,
    createdAt: new Date(),
    createdBy: input.createdBy,
    linkedVideoId: null,
    linkedAt: null,
  });
  return res.insertedId.toString();
}

/** Uploaded directly on a video's curation page — created already linked to that video, since
 * (unlike a Converter run, which produces subtitles incidentally for later linking) this action is
 * inherently "attach this subtitle to the video I'm curating right now." Stored in `title`, not
 * `language` — the admin types a free-form label (e.g. "English"), and `title` is a plain
 * display-as-typed fallback, while `language` is expected to be an ISO-ish code that gets run
 * through a code-to-name lookup elsewhere (see lib/languageNames.ts) and would otherwise mangle it. */
export async function createAndLinkSubtitleSet(input: {
  sourceLabel: string;
  label: string;
  vtt: string;
  createdBy: string;
  videoId: string;
}): Promise<string> {
  const col = await collection();
  const now = new Date();
  const res = await col.insertOne({
    _id: new ObjectId(),
    sourceLabel: input.sourceLabel,
    subtitles: [{ index: 0, language: null, title: input.label, vtt: input.vtt }],
    jobId: "manual-upload",
    createdAt: now,
    createdBy: input.createdBy,
    linkedVideoId: input.videoId,
    linkedAt: now,
  });
  return res.insertedId.toString();
}

export async function getSubtitleSet(subtitleSetId: string): Promise<SubtitleSet | null> {
  const col = await collection();
  return col.findOne({ _id: new ObjectId(subtitleSetId) });
}

export async function listSubtitleSetsByIds(subtitleSetIds: string[]): Promise<SubtitleSet[]> {
  if (subtitleSetIds.length === 0) return [];
  const col = await collection();
  return col.find({ _id: { $in: subtitleSetIds.map((id) => new ObjectId(id)) } }).toArray();
}

export async function listUnlinkedSubtitleSets(): Promise<SubtitleSet[]> {
  const col = await collection();
  return col.find({ linkedVideoId: null }).sort({ createdAt: -1 }).toArray();
}

export async function linkSubtitleSet(subtitleSetId: string, videoId: string): Promise<void> {
  const col = await collection();
  await col.updateOne(
    { _id: new ObjectId(subtitleSetId) },
    { $set: { linkedVideoId: videoId, linkedAt: new Date() } },
  );
}

export async function unlinkSubtitleSet(subtitleSetId: string): Promise<void> {
  const col = await collection();
  await col.updateOne(
    { _id: new ObjectId(subtitleSetId) },
    { $set: { linkedVideoId: null, linkedAt: null } },
  );
}

/** The admin "Delete video" action — unlike the scan sweep below, the sets go too: they were
 * uploaded for this specific video, and it's being removed on purpose. */
export async function deleteSubtitleSetsForVideo(videoId: string): Promise<number> {
  const col = await collection();
  const res = await col.deleteMany({ linkedVideoId: videoId });
  return res.deletedCount;
}

/** Used by the scan's deletion-sweep — returns subtitle sets to the unlinked pool rather than
 * leaving them pointing at a video that no longer exists. */
export async function unlinkSubtitleSetsForVideos(videoIds: string[]): Promise<void> {
  if (videoIds.length === 0) return;
  const col = await collection();
  await col.updateMany(
    { linkedVideoId: { $in: videoIds } },
    { $set: { linkedVideoId: null, linkedAt: null } },
  );
}
