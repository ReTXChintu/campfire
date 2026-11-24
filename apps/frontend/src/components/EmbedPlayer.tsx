import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import type { PlayerFrame } from "../lib/types";

/** Nothing at all after this long means the provider can't be reached from here. */
const LOAD_TIMEOUT_MS = 12_000;
const YOUTUBE_HOST = /^www\.youtube(-nocookie)?\.com$/;
// Vimeo also reports harmless things as errors, such as a browser refusing autoplay.
const VIMEO_FATAL = ["NotFoundError", "PrivacyError"];

/** The listed services' players. */
const DEFAULT_FRAME: PlayerFrame = {
  allow: "autoplay; fullscreen; encrypted-media; picture-in-picture",
  allowFullscreen: true,
  sandbox: "allow-scripts allow-same-origin allow-presentation",
  referrerPolicy: "strict-origin-when-cross-origin",
  radius: null,
  ratio: null,
};

/** A frame of this site's own pages must not share its origin: the sign-in is kept there. The server
 * refuses such an address too. */
function safeSandbox(url: string, sandbox: string): string {
  if (new URL(url).host !== window.location.host) return sandbox;
  return sandbox.split(" ").filter((flag) => flag !== "allow-same-origin").join(" ");
}

function withApi(url: string): string {
  const u = new URL(url);
  if (YOUTUBE_HOST.test(u.hostname)) {
    u.searchParams.set("enablejsapi", "1");
    u.searchParams.set("origin", window.location.origin);
  }
  return u.toString();
}

/** Whether a message from a YouTube or Vimeo player says the video can't be played. */
function saysFailed(host: string, raw: unknown): boolean {
  try {
    const message = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (message?.event === "onError") return YOUTUBE_HOST.test(host);
    return host === "player.vimeo.com" && message?.event === "error" && VIMEO_FATAL.includes(message.data?.name);
  } catch {
    return false;
  }
}

/** Plays a title in another site's own player, calling `onFailed` when that says it can't or the site
 * can't be reached. The server has already dropped ones their provider says are gone; the buttons are
 * for a failure the player doesn't report. No watch party, resume or tracks here. */
export default function EmbedPlayer({
  url,
  frame: look = DEFAULT_FRAME,
  name,
  title,
  nextFileId,
  others,
  onSelect,
  onFailed,
}: {
  url: string;
  /** How a player added by its embed code is drawn. */
  frame?: PlayerFrame;
  name: string;
  title: string;
  nextFileId: string | null;
  /** The other ways to play it. */
  others: { id: string; name: string }[];
  onSelect: (id: string) => void;
  onFailed: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const loaded = useRef(false);
  const failed = useRef(onFailed);
  useEffect(() => {
    failed.current = onFailed;
  });

  useEffect(() => {
    loaded.current = false;
    const { origin, hostname } = new URL(url);
    const timer = window.setTimeout(() => {
      if (!loaded.current) failed.current();
    }, LOAD_TIMEOUT_MS);
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== origin) return;
      if (saysFailed(hostname, event.data)) failed.current();
    };
    window.addEventListener("message", onMessage);
    // A frame "loads" the browser's own error page too, so whether the site answers at all is asked
    // apart. What it answers can't be read from here.
    const abort = new AbortController();
    fetch(url, { mode: "no-cors", credentials: "omit", referrerPolicy: "origin", signal: abort.signal }).catch(() => {
      if (!abort.signal.aborted) failed.current();
    });
    return () => {
      abort.abort();
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
  }, [url]);

  const handleLoad = () => {
    loaded.current = true;
    const { origin, hostname } = new URL(url);
    const send = (message: object) => frame.current?.contentWindow?.postMessage(JSON.stringify(message), origin);
    if (YOUTUBE_HOST.test(hostname)) {
      send({ event: "listening", id: 1, channel: "widget" });
      send({ event: "command", func: "addEventListener", args: ["onError"], id: 1, channel: "widget" });
    } else if (hostname === "player.vimeo.com") {
      send({ method: "addEventListener", value: "error" });
    }
  };

  return (
    <div>
      <iframe
        key={url}
        ref={frame}
        src={withApi(url)}
        title={title}
        onLoad={handleLoad}
        className="aspect-video w-full rounded-2xl border-0 bg-black"
        style={{ aspectRatio: look.ratio ?? undefined, borderRadius: look.radius ?? undefined }}
        allow={look.allow}
        allowFullScreen={look.allowFullscreen}
        referrerPolicy={look.referrerPolicy as ReferrerPolicy}
        sandbox={safeSandbox(url, look.sandbox)}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2.5 text-sm text-text-secondary">
        <span role="status" className="mr-auto">
          Playing from {name}.{others.length > 0 && " Not working?"}
        </span>
        {others.map((other) => (
          <button
            key={other.id}
            type="button"
            onClick={() => onSelect(other.id)}
            className="min-h-11 rounded-lg border border-divider-strong px-4 font-semibold text-white transition hover:bg-surface-hover"
          >
            Play from {other.name}
          </button>
        ))}
        {nextFileId && (
          <Link
            to={`/watch/${nextFileId}`}
            className="inline-flex min-h-11 items-center rounded-lg bg-accent px-4 font-bold text-black transition hover:brightness-110"
          >
            Next episode
          </Link>
        )}
      </div>
    </div>
  );
}
