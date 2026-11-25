import { env } from "../config/env";

/** The "any player" source: an iframe's embed code, pasted by an admin, with `{{tmdb_id}}` where the
 * movie or series' TMDb id goes. A matching title uses the code for its kind; there is nothing to
 * list or link.
 * Everything the player needs is read out of the code; whatever could reach beyond its own frame is
 * left out. */

export type FrameConfig = {
  /** The player's address, with `{{tmdb_id}}` in it. */
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

/** A player can have a different address for each kind of title. Anime is a film or a series too, so
 * without a code of its own it plays as that. */
export const FRAME_KINDS = ["movie", "tv", "anime"] as const;
export type FrameKind = (typeof FRAME_KINDS)[number];
export type FrameConfigs = Record<FrameKind, FrameConfig | null>;

/** The code a title plays by; null when the player has none for its kind. */
export function frameFor(configs: FrameConfigs, type: "movie" | "tv", anime: boolean): FrameConfig | null {
  return (anime ? configs.anime : null) ?? configs[type];
}

/** What a player page needs to draw the frame. */
export type Frame = Omit<FrameConfig, "template">;

export class FrameError extends Error {}

const PLACEHOLDER = "{{tmdb_id}}";

const MAX_CODE = 4000;
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
const PROBE = "campfire-file-id-probe";

function parseTemplate(raw: string): string {
  let address = raw.replace(/%7B/gi, "{").replace(/%7D/gi, "}").trim();
  if (!address) throw new FrameError("The iframe has no src.");
  if (address.startsWith("//")) address = `https:${address}`;
  const names = new Set<string>();
  address = address.replace(/\{\{\s*([\w.-]+)\s*\}\}|\$?\{\s*([\w.-]+)\s*\}/g, (_all, double, single) => {
    names.add((double ?? single).toLowerCase());
    return PLACEHOLDER;
  });
  const only = [...names];
  if (only.length === 0) throw new FrameError(`Put ${PLACEHOLDER} where the movie or series' TMDb ID goes in the src.`);
  if (only.length > 1 || only[0] !== "tmdb_id") {
    throw new FrameError(`The src can only have ${PLACEHOLDER}, the movie or series' TMDb ID. It has ${only.join(", ")}.`);
  }
  // Straight after the host it would run into its name.
  address = address.replace(/^([a-z]+:\/\/[^/?#{]*[a-z0-9])(\{\{tmdb_id\}\})(?=$|[/?#])/i, "$1/$2");
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
  return url.toString().replaceAll(PROBE, PLACEHOLDER);
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
  return new URL(config.template.replaceAll(PLACEHOLDER, PROBE)).hostname.replace(/^www\./, "");
}

/** The address a video plays from. */
export function frameUrl(config: FrameConfig, tmdbId: string): string {
  return config.template.replaceAll(PLACEHOLDER, () => encodeURIComponent(tmdbId));
}

export function frameOf({ allow, allowFullscreen, sandbox, referrerPolicy, radius, ratio }: FrameConfig): Frame {
  return { allow, allowFullscreen, sandbox, referrerPolicy, radius, ratio };
}
