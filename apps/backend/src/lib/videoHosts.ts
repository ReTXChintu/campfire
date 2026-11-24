import { createHmac } from "node:crypto";
import { env } from "../config/env";

/** The two video hosts a source can be (lib/videoSources.ts): what to ask their APIs, and the HLS
 * address a video plays from. Every call uses the account's own key, so a source can only ever be a
 * library its admin controls. */

export type BunnyConfig = { libraryId: string; cdnHostname: string };
export type CloudflareConfig = { accountId: string };

/** One video as its host lists it. `hls` and `signed` are Cloudflare's; Bunny's address follows
 * from the id. */
export type HostVideo = {
  videoId: string;
  name: string;
  ready: boolean;
  durationSeconds: number | null;
  height: number | null;
  captions: { language: string; label: string }[];
  hls: string | null;
  signed: boolean;
};

export class HostError extends Error {}

/** Asks a host about one title while a viewer waits, rather than for its whole library. */
export type HostSearch = { text: string; timeoutMs: number };
const MAX_SEARCH_PAGES = 5;

const TIMEOUT_MS = 15_000;
const CHECK_TIMEOUT_MS = 4000;
const MAX_PAGES = 50;
const BUNNY_PAGE = 100;
const CLOUDFLARE_PAGE = 1000;
/** Long enough for any film, pauses included. */
export const URL_LIFETIME_S = 12 * 60 * 60;

export const BUNNY_HOST = /^[a-z0-9-]+\.b-cdn\.net$/;
const CLOUDFLARE_HLS =
  /^https:\/\/(customer-[a-z0-9]+\.cloudflarestream\.com|videodelivery\.net)\/[\w.-]+\/manifest\/video\.m3u8(\?.*)?$/;
const BUNNY_ID = /^[0-9a-f-]{36}$/i;
const CLOUDFLARE_ID = /^[0-9a-f]{32}$/i;

async function call<T>(host: string, url: string, init: RequestInit, timeoutMs = TIMEOUT_MS): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new HostError(`${host} didn't answer. Try again in a minute.`);
  }
  if (res.status === 401 || res.status === 403) throw new HostError(`${host} refused the key.`);
  if (res.status === 404 || res.status === 400) throw new HostError(`${host} doesn't know that library or account ID.`);
  if (!res.ok) throw new HostError(`${host} answered ${res.status}. Try again in a minute.`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new HostError(`${host} sent an answer that couldn't be read.`);
  }
}

// ---- Bunny Stream ---------------------------------------------------------------------------------

type BunnyVideo = {
  guid?: string;
  title?: string;
  status?: number;
  length?: number;
  height?: number;
  availableResolutions?: string | null;
  captions?: { srclang?: string; label?: string }[] | null;
};

/** 4 finished; 8 ready through just-in-time encoding. */
const BUNNY_READY = [4, 8];

export async function listBunny(config: BunnyConfig, apiKey: string, search?: HostSearch): Promise<HostVideo[]> {
  const videos: HostVideo[] = [];
  let seen = 0;
  for (let page = 1; page <= (search ? MAX_SEARCH_PAGES : MAX_PAGES); page++) {
    const body = await call<{ totalItems?: number; items?: BunnyVideo[] }>(
      "Bunny",
      `${env.bunnyApiBase}/library/${encodeURIComponent(config.libraryId)}/videos?page=${page}&itemsPerPage=${BUNNY_PAGE}&orderBy=date${
        search ? `&search=${encodeURIComponent(search.text)}` : ""
      }`,
      { headers: { AccessKey: apiKey, accept: "application/json" } },
      search?.timeoutMs,
    );
    const items = body.items ?? [];
    seen += items.length;
    for (const v of items) {
      if (!v.guid || !BUNNY_ID.test(v.guid)) continue;
      const heights = (v.availableResolutions ?? "").split(",").map((r) => parseInt(r, 10)).filter(Number.isFinite);
      videos.push({
        videoId: v.guid,
        name: v.title?.trim() || v.guid,
        ready: BUNNY_READY.includes(v.status ?? -1),
        durationSeconds: v.length && v.length > 0 ? v.length : null,
        height: heights.length ? Math.max(...heights) : v.height || null,
        captions: (v.captions ?? [])
          .filter((c) => c.srclang && /^[\w-]{1,20}$/.test(c.srclang))
          .map((c) => ({ language: c.srclang!, label: c.label?.trim() || c.srclang! })),
        hls: null,
        signed: false,
      });
    }
    if (items.length === 0 || seen >= (body.totalItems ?? 0)) break;
  }
  return videos;
}

/** Bunny's directory token ("advanced token authentication"), as in its reference implementation
 * (github.com/BunnyWay/BunnyCDN.TokenAuthentication): the token goes in the path, so the playlist's
 * relative segment addresses carry it too. Returns the prefix for everything under `directory`. */
export function bunnySignedPrefix(hostname: string, directory: string, securityKey: string, expires: number): string {
  const token = createHmac("sha256", securityKey)
    .update(directory)
    .update(String(expires))
    .update(`token_path=${directory}`)
    .digest("base64url");
  return `https://${hostname}/bcdn_token=HS256-${token}&token_path=${encodeURIComponent(directory)}&expires=${expires}`;
}

export function bunnyStream(config: BunnyConfig, video: HostVideo, tokenKey: string | null) {
  const directory = `/${video.videoId}/`;
  const prefix = tokenKey
    ? bunnySignedPrefix(config.cdnHostname, directory, tokenKey, Math.floor(Date.now() / 1000) + URL_LIFETIME_S)
    : `https://${config.cdnHostname}`;
  return {
    url: `${prefix}${directory}playlist.m3u8`,
    captions: video.captions.map((c) => ({
      ...c,
      url: `${prefix}${directory}captions/${encodeURIComponent(c.language)}.vtt`,
    })),
  };
}

// ---- Cloudflare Stream ----------------------------------------------------------------------------

type CloudflareVideo = {
  uid?: string;
  meta?: { name?: unknown };
  readyToStream?: boolean;
  duration?: number;
  created?: string;
  requireSignedURLs?: boolean;
  playback?: { hls?: string };
  input?: { height?: number };
};

const cloudflareUrl = (config: CloudflareConfig) =>
  `${env.cloudflareApiBase}/accounts/${encodeURIComponent(config.accountId)}/stream`;

export async function listCloudflare(
  config: CloudflareConfig,
  apiToken: string,
  search?: HostSearch,
): Promise<HostVideo[]> {
  const videos = new Map<string, HostVideo>();
  let start: string | null = null;
  // Cloudflare pages by moving a date window: oldest first, each page from the last one's newest.
  for (let page = 0; page < (search ? MAX_SEARCH_PAGES : MAX_PAGES); page++) {
    const query = new URLSearchParams({
      asc: "true",
      limit: String(CLOUDFLARE_PAGE),
      ...(start ? { start } : {}),
      ...(search ? { search: search.text } : {}),
    });
    const body: { result?: CloudflareVideo[] } = await call(
      "Cloudflare",
      `${cloudflareUrl(config)}?${query}`,
      { headers: { authorization: `Bearer ${apiToken}` } },
      search?.timeoutMs,
    );
    const items = body.result ?? [];
    const before = videos.size;
    for (const v of items) {
      if (!v.uid || !CLOUDFLARE_ID.test(v.uid)) continue;
      const hls = v.playback?.hls ?? "";
      videos.set(v.uid, {
        videoId: v.uid,
        name: (typeof v.meta?.name === "string" && v.meta.name.trim()) || v.uid,
        ready: v.readyToStream === true && CLOUDFLARE_HLS.test(hls),
        durationSeconds: v.duration && v.duration > 0 ? v.duration : null,
        height: v.input?.height && v.input.height > 0 ? v.input.height : null,
        captions: [], // part of the stream itself
        hls: CLOUDFLARE_HLS.test(hls) ? hls : null,
        signed: v.requireSignedURLs === true,
      });
    }
    const last: string | undefined = items[items.length - 1]?.created;
    if (items.length < CLOUDFLARE_PAGE || videos.size === before || !last) break;
    start = last;
  }
  return [...videos.values()];
}

// Cloudflare limits how often tokens may be asked for, so one serves every viewer for a few hours.
const TOKEN_REUSE_MS = 3 * 60 * 60_000;
const MAX_TOKENS = 500;
const tokens = new Map<string, { until: number; token: string }>();

export async function cloudflareStream(config: CloudflareConfig, video: HostVideo, apiToken: string) {
  if (!video.hls) throw new HostError("Cloudflare has no stream for that video.");
  if (!video.signed) return { url: video.hls, captions: [] };
  const cacheKey = `${config.accountId}:${video.videoId}`;
  const hit = tokens.get(cacheKey);
  let token = hit && Date.now() < hit.until ? hit.token : null;
  if (!token) {
    const body = await call<{ result?: { token?: string } }>(
      "Cloudflare",
      `${cloudflareUrl(config)}/${video.videoId}/token`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
        body: JSON.stringify({ exp: Math.floor(Date.now() / 1000) + URL_LIFETIME_S }),
      },
    );
    token = body.result?.token ?? null;
    if (!token || !/^[\w.-]+$/.test(token)) throw new HostError("Cloudflare didn't give a playback token.");
    tokens.delete(cacheKey);
    tokens.set(cacheKey, { until: Date.now() + TOKEN_REUSE_MS, token });
    while (tokens.size > MAX_TOKENS) tokens.delete(tokens.keys().next().value!);
  }
  return { url: video.hls.replace(`/${video.videoId}/`, `/${token}/`), captions: [] };
}

// ---- Availability ---------------------------------------------------------------------------------

/** The host's answer for a stream, asked as the site's own pages would; null when there was none. */
async function streamStatus(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, {
      redirect: "manual",
      headers: { referer: `${env.frontendUrl}/` },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    await res.body?.cancel();
    return res.status;
  } catch {
    return null;
  }
}

/** Whether the host says the stream isn't there. Anything else, a refusal included, is left for the
 * player to find out: it may be meant for this server rather than a viewer. */
export async function isGone(url: string): Promise<boolean> {
  const status = await streamStatus(url);
  return status === 404 || status === 410;
}

/** Whether the host won't serve it to the site at all, for checking settings as they're saved. */
export async function isRefused(url: string): Promise<boolean> {
  const status = await streamStatus(url);
  return status === 403 || status === 404 || status === 410;
}
