import { randomUUID } from "node:crypto";
import { env } from "../config/env";
import { getCatalogFolder, type CatalogFolder } from "./catalogFolders";
import { isAnime } from "./explore";
import { getDb } from "./mongodb";
import { seal, unseal } from "./secretBox";
import { parseTitleId, tmdbKey, tmdbRefOf } from "./tmdbRef";
import { playableEmbeds } from "./embed";
import type { ArtworkFields } from "./artwork";
import {
  BUNNY_HOST,
  bunnyStream,
  cloudflareStream,
  HostError,
  isGone,
  isRefused,
  listBunny,
  listCloudflare,
  type BunnyConfig,
  type CloudflareConfig,
  type HostSearch,
  type HostVideo,
} from "./videoHosts";
import {
  FRAME_KINDS,
  FrameError,
  frameFor,
  frameOf,
  frameSiteName,
  frameUrl,
  parseFrameCode,
  type Frame,
  type FrameConfigs,
} from "./frameSource";

/** Video sources: the places a title can play from, in one global order an admin sets — Bunny Stream
 * libraries, Cloudflare Stream accounts, any other player by its embed code (lib/frameSource.ts), and
 * Drive itself. Every title can be tried in every source, with nothing to select: a viewer picks one
 * and it's looked for there and then. A host has a title when one of its videos has the TMDb id in
 * its name ("tmdb-603", "tmdb-1396-s1e2"); a player by its embed code and Drive have every one of the
 * library's files. */

export const DRIVE_ID = "drive";
const SYNC_EVERY_MS = 30 * 60_000;

export const FEATURES = [
  "autoplay",
  "exit",
  "pip",
  "sourceMenu",
  "captions",
  "quality",
  "volume",
  "fullscreen",
  "settings",
] as const;
export type Feature = (typeof FEATURES)[number];
export type Features = Record<Feature, boolean>;

type SyncState = { at: Date; error: string | null; videos: number; matched: number };

type SourceDoc = {
  _id: string;
  kind: "bunny" | "cloudflare" | "frame" | "drive";
  name: string;
  enabled: boolean;
  order: number;
  features: Features;
  config: BunnyConfig | CloudflareConfig | FrameConfigs | null;
  /** Sealed (lib/secretBox.ts); never sent to a client. */
  apiKey: string | null;
  /** Bunny only: the pull zone's token authentication key, when it's switched on there. */
  tokenKey: string | null;
  sync: SyncState | null;
};

type SourceVideoDoc = HostVideo & {
  _id: string; // `${sourceId}:${videoId}`
  sourceId: string;
  /** The title its name says it is. */
  key: string | null;
};

type VideoDoc = { _id: string; parentFolderId?: string } & Pick<ArtworkFields, "artwork" | "episodeArtwork">;

/** A problem to show next to the form field it's about. */
export class SourceInputError extends Error {}

async function sources() {
  return (await getDb()).collection<SourceDoc>("videoSources");
}
async function sourceVideos() {
  return (await getDb()).collection<SourceVideoDoc>("sourceVideos");
}

export async function ensureIndexes(): Promise<void> {
  await (await sourceVideos()).createIndex({ key: 1 });
  await (await sourceVideos()).createIndex({ sourceId: 1 });
}

const allFeatures = (): Features => Object.fromEntries(FEATURES.map((f) => [f, true])) as Features;

function parseFeatures(raw: unknown, base: Features): Features {
  const input = (raw ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    FEATURES.map((f) => [f, typeof input[f] === "boolean" ? input[f] : base[f]]),
  ) as Features;
}

/** Every source in order. Drive is always one of them, last until it's moved. */
async function ordered(): Promise<SourceDoc[]> {
  const docs = await (await sources()).find({}).sort({ order: 1 }).toArray();
  if (!docs.some((d) => d._id === DRIVE_ID)) {
    docs.push({
      _id: DRIVE_ID,
      kind: "drive",
      name: "Drive",
      enabled: true,
      order: docs.length,
      features: allFeatures(),
      config: null,
      apiKey: null,
      tokenKey: null,
      sync: null,
    });
  }
  return docs;
}

// ---- Matching -------------------------------------------------------------------------------------

/** The title a video's name says it is: "Weapons {tmdb-1078605}.mp4", "tmdb-1396-s1e2",
 * "Breaking Bad tmdb1396 S01E02". A name with an episode in it is a series'. */
export function keyFromName(name: string): string | null {
  const id = name.match(/(?<![a-z0-9])tmdb(?:id)?[\s_=:-]*(\d{1,10})(?!\d)/i)?.[1];
  if (!id) return null;
  const episode = name.match(/(?<![a-z])s(\d{1,3})[\s._-]?e(\d{1,4})(?!\d)/i);
  return episode
    ? tmdbKey({ type: "tv", id: String(Number(id)), season: Number(episode[1]), episode: Number(episode[2]) })
    : tmdbKey({ type: "movie", id: String(Number(id)) });
}

// ---- Syncing --------------------------------------------------------------------------------------

function apiKeyOf(source: SourceDoc): string {
  const key = source.apiKey ? unseal(source.apiKey) : null;
  if (!key) throw new HostError("The API key can't be read any more. Enter it again.");
  return key;
}

function listVideos(source: SourceDoc, apiKey: string, search?: HostSearch): Promise<HostVideo[]> {
  return source.kind === "bunny"
    ? listBunny(source.config as BunnyConfig, apiKey, search)
    : listCloudflare(source.config as CloudflareConfig, apiKey, search);
}

/** Saves videos as their host lists them. */
async function saveVideos(sourceId: string, videos: HostVideo[]): Promise<SourceVideoDoc[]> {
  const col = await sourceVideos();
  const docs = videos.map(
    (v): SourceVideoDoc => ({ ...v, _id: `${sourceId}:${v.videoId}`, sourceId, key: keyFromName(v.name) }),
  );
  if (docs.length) {
    await col.bulkWrite(
      docs.map((d) => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } })),
      { ordered: false },
    );
  }
  return docs;
}

async function store(sourceId: string, videos: HostVideo[]): Promise<void> {
  const col = await sourceVideos();
  const docs = await saveVideos(sourceId, videos);
  await col.deleteMany({ sourceId, _id: { $nin: docs.map((d) => d._id) } });
  await (await sources()).updateOne(
    { _id: sourceId },
    {
      $set: {
        sync: { at: new Date(), error: null, videos: docs.length, matched: docs.filter((d) => d.key).length },
      },
    },
  );
}

async function recount(sourceId: string): Promise<void> {
  const col = await sourceVideos();
  const [videos, matched] = await Promise.all([
    col.countDocuments({ sourceId }),
    col.countDocuments({ sourceId, key: { $ne: null } }),
  ]);
  await (await sources()).updateOne(
    { _id: sourceId, sync: { $ne: null } },
    { $set: { "sync.videos": videos, "sync.matched": matched } },
  );
}

/** Whether the source has an API its videos are listed through. */
const isHosted = (source: SourceDoc) => source.kind === "bunny" || source.kind === "cloudflare";

/** Lists the source's videos again. A failure keeps the videos already known and is shown in admin. */
export async function syncSource(id: string): Promise<boolean> {
  const source = await (await sources()).findOne({ _id: id });
  if (!source || !isHosted(source)) return false;
  try {
    const videos = await listVideos(source, apiKeyOf(source));
    await store(id, videos);
  } catch (error) {
    if (!(error instanceof HostError)) console.error(`[sources] ${source.name}:`, error);
    const message = error instanceof HostError ? error.message : "Something went wrong here; see the server log.";
    const previous = source.sync;
    await (await sources()).updateOne(
      { _id: id },
      { $set: { sync: { at: new Date(), error: message, videos: previous?.videos ?? 0, matched: previous?.matched ?? 0 } } },
    );
  }
  return true;
}

async function syncAll(): Promise<void> {
  for (const source of await ordered()) {
    if (isHosted(source) && source.enabled) await syncSource(source._id);
  }
}

export function startSourceSync(): void {
  const run = () => syncAll().catch((error) => console.error("[sources] sync failed:", error));
  void run();
  setInterval(run, SYNC_EVERY_MS).unref();
}

// ---- Admin ----------------------------------------------------------------------------------------

function view(source: SourceDoc) {
  return {
    id: source._id,
    kind: source.kind,
    name: source.name,
    enabled: source.enabled,
    features: source.features,
    config: source.config,
    hasApiKey: !!source.apiKey,
    hasTokenKey: !!source.tokenKey,
    sync: source.sync,
  };
}

export async function listSources() {
  return (await ordered()).map(view);
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function parseConfig(kind: "bunny" | "cloudflare", raw: unknown): BunnyConfig | CloudflareConfig {
  const input = (raw ?? {}) as Record<string, unknown>;
  if (kind === "bunny") {
    const libraryId = text(input.libraryId);
    const cdnHostname = text(input.cdnHostname)
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "");
    if (!/^\d{1,12}$/.test(libraryId)) throw new SourceInputError("The library ID is the number on the library's API page.");
    if (!BUNNY_HOST.test(cdnHostname)) throw new SourceInputError("The CDN hostname looks like vz-abc123-456.b-cdn.net.");
    return { libraryId, cdnHostname };
  }
  const accountId = text(input.accountId);
  if (!/^[0-9a-f]{32}$/i.test(accountId)) throw new SourceInputError("The account ID is 32 letters and digits.");
  return { accountId };
}

/** What an embed code is read as, for the admin form to show before saving. */
export function previewFrame(code: unknown) {
  try {
    const { config, ignored } = parseFrameCode(code);
    return { config, siteName: frameSiteName(config), ignored };
  } catch (error) {
    if (error instanceof FrameError) throw new SourceInputError(error.message);
    throw error;
  }
}

type SourceInput = {
  name?: unknown;
  enabled?: unknown;
  features?: unknown;
  config?: unknown;
  apiKey?: unknown;
  tokenKey?: unknown;
  /** An "any player" source's embed codes by kind; an empty one is none. */
  codes?: unknown;
};

function parseSecret(value: unknown, what: string): string {
  const secret = text(value);
  if (secret.length > 500 || /[^\x21-\x7e]/.test(secret)) throw new SourceInputError(`That doesn't look like ${what}.`);
  return secret;
}

/** Saves a new source: before Drive, after everything already put before it. */
async function insertSource(doc: SourceDoc): Promise<void> {
  const ids = (await ordered()).map((s) => s._id);
  await (await sources()).insertOne(doc);
  ids.splice(ids.indexOf(DRIVE_ID), 0, doc._id);
  await setOrder(ids);
}

const FRAME_LABELS = { movie: "Movies", tv: "TV series", anime: "Anime" };

function parseCodes(raw: unknown): { config: FrameConfigs; siteName: string } {
  const codes = (raw ?? {}) as Record<string, unknown>;
  const config: FrameConfigs = { movie: null, tv: null, anime: null };
  let siteName = "";
  for (const kind of FRAME_KINDS) {
    if (!text(codes[kind])) continue;
    try {
      const read = previewFrame(codes[kind]);
      config[kind] = read.config;
      siteName ||= read.siteName;
    } catch (error) {
      throw error instanceof SourceInputError ? new SourceInputError(`${FRAME_LABELS[kind]}: ${error.message}`) : error;
    }
  }
  if (!siteName) throw new SourceInputError("Paste at least one embed code.");
  return { config, siteName };
}

async function createFrameSource(input: SourceInput): Promise<string> {
  const { config, siteName } = parseCodes(input.codes);
  const doc: SourceDoc = {
    _id: randomUUID(),
    kind: "frame",
    name: text(input.name).slice(0, 60) || siteName,
    enabled: true,
    order: 0,
    features: allFeatures(),
    config,
    apiKey: null,
    tokenKey: null,
    sync: null,
  };
  await insertSource(doc);
  return doc._id;
}

/** Adds a source: a hosted one after its host has accepted the key and listed its videos. */
export async function createSource(kind: unknown, input: SourceInput): Promise<string> {
  if (kind === "frame") return createFrameSource(input);
  if (kind !== "bunny" && kind !== "cloudflare") {
    throw new SourceInputError("Pick Bunny Stream, Cloudflare Stream or any player.");
  }
  const name = text(input.name).slice(0, 60);
  if (!name) throw new SourceInputError("Give it a name.");
  const apiKey = parseSecret(input.apiKey, "an API key");
  if (!apiKey) throw new SourceInputError("Enter the API key.");
  const tokenKey = kind === "bunny" ? parseSecret(input.tokenKey, "a token authentication key") : "";
  const doc: SourceDoc = {
    _id: randomUUID(),
    kind,
    name,
    enabled: true,
    order: 0,
    features: parseFeatures(input.features, allFeatures()),
    config: parseConfig(kind, input.config),
    apiKey: seal(apiKey),
    tokenKey: tokenKey ? seal(tokenKey) : null,
    sync: null,
  };
  const videos = await listVideos(doc, apiKey);
  if (kind === "bunny") await checkBunnyCdn(doc.config as BunnyConfig, videos, tokenKey || null);
  await insertSource(doc);
  await store(doc._id, videos);
  return doc._id;
}

/** Changes a source; an empty key keeps the saved one. New connection details are tried first. */
export async function updateSource(id: string, input: SourceInput): Promise<boolean> {
  const source = (await ordered()).find((s) => s._id === id);
  if (!source) return false;
  const set: Partial<SourceDoc> = {};
  if (input.features !== undefined) set.features = parseFeatures(input.features, source.features);
  if (source.kind !== "drive") {
    if (input.name !== undefined) {
      set.name = text(input.name).slice(0, 60);
      if (!set.name) throw new SourceInputError("Give it a name.");
    }
    if (typeof input.enabled === "boolean") set.enabled = input.enabled;
  }
  if (source.kind === "frame" && input.codes !== undefined) set.config = parseCodes(input.codes).config;
  if (source.kind === "bunny" || source.kind === "cloudflare") {
    const apiKey = parseSecret(input.apiKey, "an API key");
    if (apiKey) set.apiKey = seal(apiKey);
    if (source.kind === "bunny" && input.tokenKey !== undefined) {
      // null switches signed addresses off; empty keeps the key.
      if (input.tokenKey === null) set.tokenKey = null;
      else {
        const tokenKey = parseSecret(input.tokenKey, "a token authentication key");
        if (tokenKey) set.tokenKey = seal(tokenKey);
      }
    }
    if (input.config !== undefined) set.config = parseConfig(source.kind, input.config);
    const next = { ...source, ...set };
    const reconnects =
      apiKey || set.tokenKey !== undefined || (set.config && JSON.stringify(set.config) !== JSON.stringify(source.config));
    if (reconnects) {
      const videos = await listVideos(next, apiKeyOf(next));
      if (source.kind === "bunny") {
        await checkBunnyCdn(next.config as BunnyConfig, videos, next.tokenKey ? unseal(next.tokenKey) : null);
      }
      await (await sources()).updateOne({ _id: id }, { $set: set });
      await store(id, videos);
      return true;
    }
  }
  if (Object.keys(set).length) {
    if (id === DRIVE_ID) {
      const { _id, ...rest } = { ...source, ...set };
      await (await sources()).updateOne({ _id }, { $set: rest }, { upsert: true });
    } else {
      await (await sources()).updateOne({ _id: id }, { $set: set });
    }
  }
  return true;
}

/** The order players try them in. Ids left out keep their places after these. */
export async function setOrder(ids: string[]): Promise<void> {
  const current = await ordered();
  const known = ids.filter((id, i) => current.some((s) => s._id === id) && ids.indexOf(id) === i);
  const rest = current.filter((s) => !known.includes(s._id)).map((s) => s._id);
  const col = await sources();
  for (const [order, id] of [...known, ...rest].entries()) {
    if (id === DRIVE_ID) {
      const { _id, ...drive } = { ...current.find((s) => s._id === DRIVE_ID)!, order };
      await col.updateOne({ _id }, { $set: drive }, { upsert: true });
    } else {
      await col.updateOne({ _id: id }, { $set: { order } });
    }
  }
}

export async function deleteSource(id: string): Promise<boolean> {
  if (id === DRIVE_ID) return false;
  const { deletedCount } = await (await sources()).deleteOne({ _id: id });
  await (await sourceVideos()).deleteMany({ sourceId: id });
  return deletedCount > 0;
}

/** Bunny's CDN hostname and token key can't be checked through its API, so a few of the library's own
 * videos are: none of them there means one of the two is wrong. */
async function checkBunnyCdn(config: BunnyConfig, videos: HostVideo[], tokenKey: string | null): Promise<void> {
  const ready = videos.filter((v) => v.ready).slice(0, 3);
  const refused = await Promise.all(ready.map((v) => isRefused(bunnyStream(config, v, tokenKey).url)));
  if (ready.length && refused.every(Boolean)) {
    throw new SourceInputError(
      `Bunny won't play this library's videos from that CDN hostname. Check the hostname, that this site is in the library's allowed domains, and ${
        tokenKey ? "the token authentication key" : "whether it needs a token authentication key"
      }.`,
    );
  }
}

// ---- Playing --------------------------------------------------------------------------------------

/** One way to play a title. `id` is what a client asks for it by. */
export type PlayerOption =
  | { id: string; kind: "embed"; name: string; url: string }
  | { id: string; kind: "frame"; name: string; url: string; frame: Frame }
  | { id: string; kind: "stream"; name: string; features: Features }
  | { id: string; kind: "drive"; name: string; features: Features };

async function matching(video: VideoDoc, sourceIds: string[]): Promise<SourceVideoDoc[]> {
  const ref = tmdbRefOf(video);
  if (!ref) return [];
  const found = await (await sourceVideos())
    .find({ key: tmdbKey(ref), sourceId: { $in: sourceIds }, ready: true })
    .toArray();
  // The sharpest copy first.
  return found.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
}

const LIVE_TIMEOUT_MS = 4000;
/** A host that just said it hasn't got a title isn't asked again by the same click. */
const MISS_TTL_MS = 3000;
const MAX_ASKED = 500;
const asked = new Map<string, { until: number; answer: Promise<boolean> }>();

/** Asks a host, there and then, whether it has a title that isn't among the videos known to be there.
 * What it finds is saved like any other. Rejects when the host doesn't answer. */
function askHost(source: SourceDoc, video: VideoDoc): Promise<boolean> {
  const ref = tmdbRefOf(video);
  if (!ref || !isHosted(source)) return Promise.resolve(false);
  const key = tmdbKey(ref);
  const id = `${source._id}:${key}`;
  const hit = asked.get(id);
  if (hit && Date.now() < hit.until) return hit.answer;
  const answer = (async () => {
    const listed = await listVideos(source, apiKeyOf(source), { text: ref.id, timeoutMs: LIVE_TIMEOUT_MS });
    const found = listed.filter((v) => keyFromName(v.name) === key);
    if (found.length === 0) return false;
    await saveVideos(source._id, found);
    await recount(source._id);
    return (await matching(video, [source._id])).length > 0;
  })();
  asked.delete(id);
  asked.set(id, { until: Date.now() + MISS_TTL_MS, answer });
  answer.catch(() => asked.delete(id));
  while (asked.size > MAX_ASKED) asked.delete(asked.keys().next().value!);
  return answer;
}

/** The sources a viewer can pick from, in order. */
export async function listViewerSources(): Promise<{ id: string; name: string }[]> {
  const all = await ordered();
  return all
    .filter((s) => s.enabled || s.kind === "drive")
    .map((s) => ({ id: s._id, name: s.kind === "drive" ? "Drive" : s.name }));
}

/** Whether a video is a film or part of a series, and whether it's anime, as TMDb says. One it doesn't
 * know goes by the series it's in; failing that, it's a film when it's loose in the library and part of
 * a series when it's in a folder. */
async function kindOf(video: VideoDoc): Promise<{ type: "movie" | "tv"; anime: boolean }> {
  const own = tmdbRefOf(video);
  if (own) return { type: own.type, anime: await isAnime(own.type, own.id) };
  let folderId = video.parentFolderId;
  if (folderId === undefined || folderId === env.driveRootFolderId) return { type: "movie", anime: false };
  // A season's folder, then its series'.
  for (let depth = 0; depth < 2 && folderId !== env.driveRootFolderId; depth++) {
    const folder: CatalogFolder | null = await getCatalogFolder(folderId);
    if (!folder) break;
    const ref = tmdbRefOf(folder);
    if (ref) return { type: ref.type, anime: await isAnime(ref.type, ref.id) };
    folderId = folder.parentFolderId;
  }
  return { type: "tv", anime: false };
}

/** The ways to play a title, in order: the players set on the title itself, then the sources known to
 * have it, Drive among them. With `all`, every host, known to have it or not: it's asked when the
 * viewer picks it (streamFor). */
export async function playersFor(video: VideoDoc, { all = false }: { all?: boolean } = {}): Promise<PlayerOption[]> {
  const [embeds, list] = await Promise.all([playableEmbeds(video), ordered()]);
  // A title the library doesn't have has no file of its own to play.
  const hasFile = !parseTitleId(video._id);
  const enabled = list.filter((s) => s.enabled || s.kind === "drive");
  const hosted = enabled.filter(isHosted).map((s) => s._id);
  const have = new Set(all ? hosted : hosted.length ? (await matching(video, hosted)).map((v) => v.sourceId) : []);
  const tmdb = tmdbRefOf(video);
  const kind = hasFile && tmdb && enabled.some((s) => s.kind === "frame") ? await kindOf(video) : null;
  const options = enabled.flatMap((s): PlayerOption[] => {
    const features = parseFeatures(s.features, allFeatures());
    if (s.kind === "drive") return hasFile ? [{ id: s._id, kind: "drive", name: "Drive", features }] : [];
    if (s.kind === "frame") {
      const config = kind && frameFor(s.config as FrameConfigs, kind.type, kind.anime);
      if (!config) return [];
      return [{ id: s._id, kind: "frame", name: s.name, url: frameUrl(config, tmdb!.id), frame: frameOf(config) }];
    }
    return have.has(s._id) ? [{ id: s._id, kind: "stream", name: s.name, features }] : [];
  });
  return [...embeds.map((e, i): PlayerOption => ({ id: `embed-${i}`, kind: "embed", name: e.provider, url: e.url })), ...options];
}

/** Where a title streams from in one source, with addresses that expire; null when it isn't there. */
export async function streamFor(sourceId: string, video: VideoDoc) {
  const source = await (await sources()).findOne({ _id: sourceId, enabled: true });
  if (!source || !isHosted(source)) return null;
  let [found] = await matching(video, [sourceId]);
  if (!found && (await askHost(source, video))) [found] = await matching(video, [sourceId]);
  if (!found) return null;
  let stream;
  if (source.kind === "bunny") {
    const tokenKey = source.tokenKey ? unseal(source.tokenKey) : null;
    if (source.tokenKey && !tokenKey) throw new HostError("The token authentication key can't be read any more.");
    stream = bunnyStream(source.config as BunnyConfig, found, tokenKey);
  } else {
    stream = await cloudflareStream(source.config as CloudflareConfig, found, apiKeyOf(source));
  }
  return (await isGone(stream.url)) ? null : stream;
}
