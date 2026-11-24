import { getDb } from "./mongodb";
import { tmdbKey, tmdbRefOf } from "./tmdbRef";
import type { ArtworkFields } from "./artwork";

/** Embedded players: a title can play from a hosting service's own player instead of its Drive
 * file. An admin adds up to MAX_EMBEDS per title, tried in order; the Drive file is what plays when
 * none of them works. Only the services below — add one only if you have permission to show what
 * it hosts. Stored by TMDb identity (lib/tmdbRef.ts), or by file for an unmatched video. */

export const MAX_EMBEDS = 5;
const MAX_START_SECONDS = 24 * 60 * 60;
// A provider can take seconds over a video it does not have; a viewer opening a title waits less.
const CHECK_TIMEOUT_MS = 10_000;
const VIEWER_WAIT_MS = 2500;
const OK_TTL_MS = 30 * 60_000;
const DEAD_TTL_MS = 5 * 60_000;
const MAX_CHECKS = 1000;

export type EmbedOptions = {
  startAt: number | null; // seconds
  autoplay: boolean;
  muted: boolean;
  hideControls: boolean;
};

export type Embed = { url: string; enabled: boolean } & EmbedOptions;

type Param = [name: string, value: string];

type Provider = {
  name: string;
  example: string;
  host: RegExp;
  path: RegExp;
  /** The options this service's player takes, and how it takes them. */
  options: {
    startAt?: (seconds: number) => Param | { hash: string };
    autoplay?: Param;
    muted?: Param;
    hideControls?: Param;
  };
  /** Whether the video is gone, from the provider's own answer. Anything unclear counts as alive. */
  isDead: (embed: URL) => Promise<boolean>;
};

const get = (url: string) => fetch(url, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS), redirect: "manual" });

async function statusIn(url: string, dead: number[]): Promise<boolean> {
  const res = await get(url);
  await res.body?.cancel();
  return dead.includes(res.status);
}

const PROVIDERS: Provider[] = [
  {
    name: "YouTube",
    example: "https://www.youtube.com/watch?v=…",
    host: /^www\.youtube(-nocookie)?\.com$/,
    path: /^\/embed\/[\w-]{11}$/,
    options: {
      startAt: (s) => ["start", String(s)],
      autoplay: ["autoplay", "1"],
      muted: ["mute", "1"],
      hideControls: ["controls", "0"],
    },
    // 401 is a video whose owner turned embedding off.
    isDead: (u) => {
      const page = `https://www.youtube.com/watch?v=${u.pathname.split("/")[2]}`;
      return statusIn(
        `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(page)}`,
        [400, 401, 403, 404],
      );
    },
  },
  {
    name: "Vimeo",
    example: "https://vimeo.com/76979871",
    host: /^player\.vimeo\.com$/,
    path: /^\/video\/\d+$/,
    options: {
      startAt: (s) => ({ hash: `t=${s}s` }),
      autoplay: ["autoplay", "1"],
      muted: ["muted", "1"],
      hideControls: ["controls", "0"],
    },
    // Not 403: a video limited to certain sites answers that to this server but plays on the page.
    isDead: (u) => {
      const hash = u.searchParams.get("h");
      const page = `https://vimeo.com/${u.pathname.split("/")[2]}${hash ? `/${hash}` : ""}`;
      return statusIn(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(page)}`, [404]);
    },
  },
  {
    name: "Bunny Stream",
    example: "https://iframe.mediadelivery.net/embed/<library>/<video>",
    host: /^(iframe|player)\.mediadelivery\.net$/,
    path: /^\/embed\/\d+\/[\w-]+$/,
    options: {
      startAt: (s) => ["t", String(s)],
      autoplay: ["autoplay", "true"],
      muted: ["muted", "true"],
    },
    // Bunny answers 200 with a page titled "404".
    isDead: async (u) => {
      const res = await get(u.toString());
      const html = await res.text();
      return res.status === 404 || /<title>\s*404\s*<\/title>/i.test(html);
    },
  },
  {
    name: "Cloudflare Stream",
    example: "https://customer-<code>.cloudflarestream.com/<video>/iframe",
    host: /^customer-\w+\.cloudflarestream\.com$/,
    path: /^\/[\w.-]+\/iframe$/,
    options: {
      startAt: (s) => ["startTime", `${s}s`],
      autoplay: ["autoplay", "true"],
      muted: ["muted", "true"],
      hideControls: ["controls", "false"],
    },
    // The player page is 200 for any id; the video itself isn't.
    isDead: (u) => statusIn(`${u.origin}/${u.pathname.split("/")[1]}/manifest/video.m3u8`, [404]),
  },
  {
    name: "Internet Archive",
    example: "https://archive.org/details/BigBuckBunny_124",
    host: /^archive\.org$/,
    path: /^\/embed\/[\w.%-]+$/,
    options: {
      startAt: (s) => ["start", String(s)],
      autoplay: ["autoplay", "1"],
    },
    isDead: (u) => statusIn(u.toString(), [404]),
  },
];

/** For the admin form: what each service accepts. */
export function embedProviders() {
  return PROVIDERS.map((p) => ({
    name: p.name,
    example: p.example,
    supports: Object.keys(p.options) as (keyof EmbedOptions)[],
  }));
}

function providerOf(url: URL): Provider | null {
  return PROVIDERS.find((p) => p.host.test(url.hostname) && p.path.test(url.pathname)) ?? null;
}

export function providerName(url: string): string | null {
  return URL.canParse(url) ? (providerOf(new URL(url))?.name ?? null) : null;
}

/** An ordinary page address of a listed provider, turned into its player's address. */
function toPlayerUrl(url: URL): URL {
  const host = url.hostname.replace(/^(www|m)\./, "");
  const youtubeId =
    host === "youtu.be"
      ? url.pathname.slice(1)
      : host === "youtube.com" && url.pathname === "/watch"
        ? url.searchParams.get("v")
        : null;
  if (youtubeId) return new URL(`https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}`);
  const vimeo = host === "vimeo.com" ? url.pathname.match(/^\/(\d+)(?:\/(\w+))?$/) : null;
  if (vimeo) return new URL(`https://player.vimeo.com/video/${vimeo[1]}${vimeo[2] ? `?h=${vimeo[2]}` : ""}`);
  const archive = host === "archive.org" ? url.pathname.match(/^\/details\/([^/]+)$/) : null;
  if (archive) return new URL(`https://archive.org/embed/${archive[1]}`);
  return url;
}

/** The player address to store, or null when it isn't an https address of a listed provider. */
export function parseEmbedUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !URL.canParse(raw.trim())) return null;
  const given = new URL(raw.trim());
  if (given.protocol !== "https:" || given.username || given.password || given.port) return null;
  const url = toPlayerUrl(given);
  return providerOf(url) ? url.toString() : null;
}

/** One entry of the admin form, or a message saying what's wrong with it. */
export function parseEmbed(raw: unknown): Embed | string {
  const input = (raw ?? {}) as Record<string, unknown>;
  const url = parseEmbedUrl(input.url);
  if (!url) return `isn't an https link from ${PROVIDERS.map((p) => p.name).join(", ")}`;
  const startAt = input.startAt ?? null;
  if (startAt !== null && (!Number.isInteger(startAt) || (startAt as number) < 0 || (startAt as number) > MAX_START_SECONDS)) {
    return "has a start time that isn't a whole number of seconds within a day";
  }
  return {
    url,
    enabled: input.enabled !== false,
    startAt: (startAt as number | null) || null,
    autoplay: input.autoplay === true,
    muted: input.muted === true,
    hideControls: input.hideControls === true,
  };
}

/** The address to load, with the options in the form this provider takes them. Ones it doesn't
 * support are left out. */
export function playerUrl(embed: Embed): string {
  const url = new URL(embed.url);
  const options = providerOf(url)?.options ?? {};
  const set = ([name, value]: Param) => url.searchParams.set(name, value);
  if (embed.startAt && options.startAt) {
    const start = options.startAt(embed.startAt);
    if (Array.isArray(start)) set(start);
    else url.hash = start.hash;
  }
  if (embed.autoplay && options.autoplay) set(options.autoplay);
  if (embed.muted && options.muted) set(options.muted);
  if (embed.hideControls && options.hideControls) set(options.hideControls);
  return url.toString();
}

// ---- Storage --------------------------------------------------------------------------------------

type EmbedDoc = { _id: string; embeds: Embed[]; updatedAt: Date };
type VideoDoc = { _id: string } & Pick<ArtworkFields, "artwork" | "episodeArtwork">;

async function collection() {
  return (await getDb()).collection<EmbedDoc>("titleEmbeds");
}

const fileKey = (fileId: string) => `file:${fileId}`;

/** By TMDb identity first; by file when that has none (or the video was matched only later). */
export async function embedsFor(video: VideoDoc): Promise<Embed[]> {
  const ref = tmdbRefOf(video);
  const keys = [...(ref ? [tmdbKey(ref)] : []), fileKey(video._id)];
  const docs = await (await collection()).find({ _id: { $in: keys } }).toArray();
  for (const key of keys) {
    const embeds = docs.find((d) => d._id === key)?.embeds;
    // Checked again on the way out, so a provider taken off the list stops playing at once.
    if (embeds?.length) return embeds.filter((e) => parseEmbedUrl(e.url) === e.url);
  }
  return [];
}

export async function saveEmbeds(video: VideoDoc, embeds: Embed[]): Promise<void> {
  const ref = tmdbRefOf(video);
  const key = ref ? tmdbKey(ref) : fileKey(video._id);
  const col = await collection();
  if (embeds.length) await col.updateOne({ _id: key }, { $set: { embeds, updatedAt: new Date() } }, { upsert: true });
  else await col.deleteOne({ _id: key });
  if (ref) await col.deleteOne({ _id: fileKey(video._id) });
}

/** Deleting a file drops what was stored under the file itself; a title's embeds outlive it. */
export async function deleteFileEmbeds(fileIds: string[]): Promise<void> {
  await (await collection()).deleteMany({ _id: { $in: fileIds.map(fileKey) } });
}

export async function deleteEmbedsByKey(key: string): Promise<boolean> {
  return (await (await collection()).deleteOne({ _id: key })).deletedCount > 0;
}

type NamedVideo = VideoDoc & { title: string | null; driveName: string };

async function allVideos(): Promise<NamedVideo[]> {
  const db = await getDb();
  const projection = {
    title: 1, driveName: 1,
    "artwork.tmdbType": 1, "artwork.tmdbId": 1,
    "episodeArtwork.seriesTmdbId": 1, "episodeArtwork.season": 1, "episodeArtwork.episode": 1,
  };
  return db.collection<NamedVideo>("catalogVideos").find({}, { projection }).toArray();
}

const label = (v: NamedVideo) => v.title ?? v.driveName;

/** Every title with players. `fileId` is null when no file of it is in the catalog any more. */
export async function listEmbeds() {
  const [docs, videos] = await Promise.all([(await collection()).find({}).sort({ updatedAt: -1 }).toArray(), allVideos()]);
  const byKey = new Map<string, NamedVideo>();
  for (const v of videos) {
    const ref = tmdbRefOf(v);
    byKey.set(fileKey(v._id), v);
    if (ref) byKey.set(tmdbKey(ref), v);
  }
  return docs.map((doc) => {
    const video = byKey.get(doc._id);
    return {
      key: doc._id,
      fileId: video?._id ?? null,
      title: video ? label(video) : null,
      embeds: doc.embeds.map((e) => ({ provider: providerName(e.url), enabled: e.enabled })),
    };
  });
}

/** Catalog videos whose name contains `query`, for the admin page's "add" search. */
export async function searchVideos(query: string) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return (await allVideos())
    .filter((v) => label(v).toLowerCase().includes(q) || v.driveName.toLowerCase().includes(q))
    .slice(0, 12)
    .map((v) => ({ fileId: v._id, title: label(v), driveName: v.driveName }));
}

// ---- Availability ---------------------------------------------------------------------------------

const checks = new Map<string, { until: number; alive: Promise<boolean> }>();

function isAlive(raw: string): Promise<boolean> {
  const hit = checks.get(raw);
  if (hit && Date.now() < hit.until) return hit.alive;
  const url = new URL(raw);
  const provider = providerOf(url);
  const alive = (provider ? provider.isDead(url) : Promise.resolve(true)).then(
    (dead) => !dead,
    // No answer isn't "gone": the viewer's own connection may well reach it.
    () => true,
  );
  const entry = { until: Date.now() + OK_TTL_MS, alive };
  checks.delete(raw);
  checks.set(raw, entry);
  alive.then((ok) => {
    if (!ok) entry.until = Date.now() + DEAD_TTL_MS;
  });
  while (checks.size > MAX_CHECKS) checks.delete(checks.keys().next().value!);
  return alive;
}

/** For the admin form, which shows a player its provider says is gone. */
export async function withStatus(embeds: Embed[]) {
  return Promise.all(
    embeds.map(async (e) => ({
      ...e,
      provider: providerName(e.url),
      playerUrl: playerUrl(e),
      available: await isAlive(e.url),
    })),
  );
}

export type PlayableEmbed = { provider: string; url: string };

const soon = () => new Promise<boolean>((resolve) => setTimeout(resolve, VIEWER_WAIT_MS, true).unref());

/** A video's players in the order to try them, without those switched off or gone. */
export async function playableEmbeds(video: VideoDoc): Promise<PlayableEmbed[]> {
  const embeds = (await embedsFor(video)).filter((e) => e.enabled);
  if (embeds.length === 0) return [];
  // One still being checked counts as alive; the answer is kept for the next viewer.
  const alive = await Promise.all(embeds.map((e) => Promise.race([isAlive(e.url), soon()])));
  return embeds
    .filter((_, i) => alive[i])
    .map((e) => ({ provider: providerName(e.url)!, url: playerUrl(e) }));
}
