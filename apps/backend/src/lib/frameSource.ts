import { env } from "../config/env";

/** The "any player" source: an iframe's embed code, pasted by an admin, with a placeholder where the
 * video's id goes. Everything the player needs is read out of the code; whatever could reach beyond
 * its own frame is left out. The id is either the site's own, given per video by an admin
 * (`{{media_id}}`), or the video's Drive file id (`{{file_id}}`), for a player that holds the
 * library's own files: that one has every video without listing any. */

export type FrameConfig = {
  /** The player's address, with one of the placeholders in it. */
  template: string;
  /** Permission policy features, ";"-separated. */
  allow: string;
  allowFullscreen: boolean;
  sandbox: string;
  referrerPolicy: string;
  /** Rounded corners in px; null leaves them as Campfire's players have them. */
  radius: number | null;
  /** Width over height; null when the code fills its container. */
  ratio: number | null;
};

/** What a player page needs to draw the frame. */
export type Frame = Omit<FrameConfig, "template">;

export class FrameError extends Error {}

const PLACEHOLDER = "{{media_id}}";
const FILE_PLACEHOLDER = "{{file_id}}";

const MAX_CODE = 4000;
const MAX_MEDIA_ID = 300;
const DEFAULT_ALLOW = "autoplay; fullscreen; encrypted-media; picture-in-picture";
const DEFAULT_SANDBOX = "allow-scripts allow-same-origin allow-presentation";
const DEFAULT_REFERRER = "strict-origin-when-cross-origin";

/** What a video player may ask of the browser; the camera, location and the like aren't among them. */
const ALLOWED_FEATURES = [
  "accelerometer", "autoplay", "clipboard-write", "encrypted-media", "fullscreen", "gyroscope",
  "picture-in-picture", "screen-wake-lock", "web-share",
];
/** Everything but navigating Campfire itself away, and downloads. */
const ALLOWED_SANDBOX = [
  "allow-forms", "allow-modals", "allow-orientation-lock", "allow-pointer-lock", "allow-popups",
  "allow-popups-to-escape-sandbox", "allow-presentation", "allow-same-origin", "allow-scripts",
  "allow-storage-access-by-user-activation",
];
/** Not unsafe-url: a watch address can carry a party's code. */
const ALLOWED_REFERRER = [
  "no-referrer", "no-referrer-when-downgrade", "origin", "origin-when-cross-origin", "same-origin",
  "strict-origin", "strict-origin-when-cross-origin",
];
const FULLSCREEN = ["allowfullscreen", "webkitallowfullscreen", "mozallowfullscreen"];
/** Read, or set by Campfire's player itself, so not worth a line in what was left out. */
const HANDLED = [
  ...FULLSCREEN, "src", "data-src", "allow", "sandbox", "referrerpolicy", "style", "width", "height",
  "frameborder", "border", "scrolling", "title", "name", "id", "class", "loading", "marginwidth", "marginheight",
];

const decodeEntities = (value: string) =>
  value
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;|&#38;/g, "&");

/** The first iframe's attributes, or null when there's no iframe. */
function attributesOf(code: string): Map<string, string> | null {
  const tag = code.match(/<iframe\b((?:"[^"]*"|'[^']*'|[^'">])*)>/i);
  if (!tag) return null;
  const attributes = new Map<string, string>();
  for (const m of tag[1].matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+)))?/g)) {
    const name = m[1].toLowerCase();
    if (!attributes.has(name)) attributes.set(name, decodeEntities(m[2] ?? m[3] ?? m[4] ?? "").trim());
  }
  return attributes;
}

/** Stands in for the id while an address is checked; nothing a real one would hold. */
const PROBE = "campfire-media-id-probe";

function parseTemplate(raw: string): string {
  let address = raw.replace(/%7B/gi, "{").replace(/%7D/gi, "}").trim();
  if (!address) throw new FrameError("The iframe has no src.");
  if (address.startsWith("//")) address = `https:${address}`;
  const names = new Set<string>();
  address = address.replace(/\{\{\s*([\w.-]+)\s*\}\}|\$?\{\s*([\w.-]+)\s*\}/g, (_all, double, single) => {
    names.add((double ?? single).toLowerCase());
    return PLACEHOLDER;
  });
  if (names.size === 0) {
    throw new FrameError(
      `Put ${PLACEHOLDER} where the video's ID goes in the src, or ${FILE_PLACEHOLDER} for its Drive file ID.`,
    );
  }
  if (names.size > 1) {
    throw new FrameError(`The src has more than one placeholder (${[...names].join(", ")}); it can have only one.`);
  }
  const placeholder = names.has("file_id") ? FILE_PLACEHOLDER : PLACEHOLDER;
  // Straight after the host it would run into its name.
  address = address.replace(/^([a-z]+:\/\/[^/?#{]*[a-z0-9])(\{\{media_id\}\})(?=$|[/?#])/i, "$1/$2");
  const probe = address.replaceAll(PLACEHOLDER, PROBE);
  if (!URL.canParse(probe)) {
    throw new FrameError(`The src isn't a full address, such as https://player.example.com/${PLACEHOLDER}.`);
  }
  const url = new URL(probe);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new FrameError("The src has to start with https:// or http://.");
  if (url.username || url.password) throw new FrameError("The src can't have a user name or password in it.");
  if (url.host.includes(PROBE)) throw new FrameError(`${PLACEHOLDER} can't be part of the site's name.`);
  // Framed here, Campfire's own pages could reach the viewer's sign-in.
  if (url.host === new URL(env.frontendUrl).host) throw new FrameError("The src can't be Campfire itself.");
  return url.toString().replaceAll(PROBE, placeholder);
}

function parseRadius(style: string): number | null {
  const radius = style.match(/(?:^|;)\s*border-radius\s*:\s*(\d{1,3})(?:\.\d+)?(?:px)?\s*(?:;|!|$)/i);
  return radius ? Math.min(Number(radius[1]), 64) : null;
}

const pixels = (value: string | undefined) => Number(value?.match(/^(\d{1,5})(?:px)?$/)?.[1] ?? 0);

function parseRatio(width: string | undefined, height: string | undefined): number | null {
  const w = pixels(width);
  const h = pixels(height);
  // Beyond these it isn't the shape of a video.
  return w && h ? Math.min(Math.max(w / h, 0.5), 3) : null;
}

const unique = (values: string[]) => [...new Set(values)];

/** Reads an embed code, or a bare address. `ignored` is what was in it and isn't used. */
export function parseFrameCode(raw: unknown): { config: FrameConfig; ignored: string[] } {
  const code = typeof raw === "string" ? raw.trim() : "";
  if (!code) throw new FrameError("Paste the player's embed code.");
  if (code.length > MAX_CODE) throw new FrameError("That's too long for an embed code.");
  const attributes = attributesOf(code);
  if (!attributes && /[<>]/.test(code)) throw new FrameError("There's no complete <iframe> in that.");
  const get = (name: string) => attributes?.get(name);
  const template = parseTemplate(attributes ? get("src") || get("data-src") || "" : code);
  const ignored: string[] = [];

  const features = unique(
    (get("allow") ?? DEFAULT_ALLOW).split(/[;,]/).map((f) => f.trim().split(/\s/)[0].toLowerCase()).filter(Boolean),
  );
  ignored.push(...features.filter((f) => !ALLOWED_FEATURES.includes(f)).map((f) => `allow: ${f}`));
  // An empty sandbox would stop any player, so that counts as none given.
  const flags = unique((get("sandbox") || DEFAULT_SANDBOX).toLowerCase().split(/\s+/));
  ignored.push(...flags.filter((f) => !ALLOWED_SANDBOX.includes(f)).map((f) => `sandbox: ${f}`));
  const referrer = get("referrerpolicy")?.toLowerCase() ?? "";
  if (referrer && !ALLOWED_REFERRER.includes(referrer)) ignored.push(`referrerpolicy: ${referrer}`);
  for (const name of attributes?.keys() ?? []) if (!HANDLED.includes(name)) ignored.push(name);

  const allow = features.filter((f) => ALLOWED_FEATURES.includes(f));
  return {
    config: {
      template,
      allow: allow.join("; "),
      allowFullscreen:
        allow.includes("fullscreen") || FULLSCREEN.some((name) => attributes?.has(name) && get(name) !== "false"),
      sandbox: flags.filter((f) => ALLOWED_SANDBOX.includes(f)).join(" "),
      referrerPolicy: ALLOWED_REFERRER.includes(referrer) ? referrer : DEFAULT_REFERRER,
      radius: parseRadius(get("style") ?? ""),
      ratio: parseRatio(get("width"), get("height")),
    },
    ignored,
  };
}

/** The name a source gets when the admin doesn't type one. */
export function frameSiteName(config: FrameConfig): string {
  return new URL(config.template.replace(/\{\{\w+\}\}/g, PROBE)).hostname.replace(/^www\./, "");
}

/** Whether the player goes by Drive file ids, and so has every video. */
export const playsEveryFile = (config: FrameConfig) => config.template.includes(FILE_PLACEHOLDER);

/** A video's id on the site, as typed: one word, and nothing that climbs out of its path. */
function parseMediaId(raw: string): string | null {
  const id = raw.replace(/^\/+/, "");
  if (!id || id.length > MAX_MEDIA_ID || /[\s\\\p{Cc}\p{Cs}]/u.test(id)) return null;
  return id.split("/").some((part) => part === "." || part === "..") ? null : id;
}

/** The address a video plays from. Everything in the id but "/" is escaped, so it stays an id. */
export function frameUrl(config: FrameConfig, id: string): string {
  return config.template.replace(/\{\{(media|file)_id\}\}/g, () => id.split("/").map(encodeURIComponent).join("/"));
}

export function frameOf({ allow, allowFullscreen, sandbox, referrerPolicy, radius, ratio }: FrameConfig): Frame {
  return { allow, allowFullscreen, sandbox, referrerPolicy, radius, ratio };
}

/** Stands where the id goes in a listed title that still needs one; such lines aren't added. */
export const NO_ID = "?";

/** "abc123" or "abc123 The Matrix {tmdb-603}", one video per line: the id, then a name to know it by. */
export function parseVideoLines(raw: unknown): { videos: { videoId: string; name: string }[]; bad: string[] } {
  const lines = typeof raw === "string" ? raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
  const videos = new Map<string, { videoId: string; name: string }>();
  const bad: string[] = [];
  for (const line of lines) {
    const [first, ...rest] = line.split(/\s+/);
    if (first === NO_ID) continue;
    const videoId = parseMediaId(first);
    if (videoId) videos.set(videoId, { videoId, name: rest.join(" ").slice(0, 200) || videoId });
    else bad.push(line);
  }
  return { videos: [...videos.values()], bad };
}
