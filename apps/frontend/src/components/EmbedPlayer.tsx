import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

/** Nothing at all after this long means the provider can't be reached from here. */
const LOAD_TIMEOUT_MS = 12_000;
const YOUTUBE_HOST = /^www\.youtube(-nocookie)?\.com$/;
// Vimeo also reports harmless things as errors, such as a browser refusing autoplay.
const VIMEO_FATAL = ["NotFoundError", "PrivacyError"];

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

/** Plays a title in a hosting service's own player, moving to the next one when a player fails and
 * to the library's own file (`onUseLibrary`) after the last. The server has already dropped players
 * their provider says are gone; the buttons are for a failure the player doesn't report. No watch
 * party, resume or tracks here. */
export default function EmbedPlayer({
  embeds,
  title,
  nextFileId,
  onUseLibrary,
}: {
  embeds: { provider: string; url: string }[];
  title: string;
  nextFileId: string | null;
  onUseLibrary: () => void;
}) {
  // Kept as first given: a background refetch must not swap the player under the viewer.
  const [list] = useState(embeds);
  const [index, setIndex] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const loaded = useRef(false);
  const current = list[index];
  const next = list[index + 1];

  const advance = useRef(() => {});
  useEffect(() => {
    advance.current = () => (next ? setIndex(index + 1) : onUseLibrary());
  });

  useEffect(() => {
    loaded.current = false;
    const { origin, hostname } = new URL(current.url);
    const timer = window.setTimeout(() => {
      if (!loaded.current) advance.current();
    }, LOAD_TIMEOUT_MS);
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== origin) return;
      if (saysFailed(hostname, event.data)) advance.current();
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
  }, [current.url]);

  const handleLoad = () => {
    loaded.current = true;
    const { origin, hostname } = new URL(current.url);
    const send = (message: object) => frame.current?.contentWindow?.postMessage(JSON.stringify(message), origin);
    if (YOUTUBE_HOST.test(hostname)) {
      send({ event: "listening", id: 1, channel: "widget" });
      send({ event: "command", func: "addEventListener", args: ["onError"], id: 1, channel: "widget" });
    } else if (hostname === "player.vimeo.com") {
      send({ method: "addEventListener", value: "error" });
    }
  };

  const button =
    "min-h-11 rounded-lg border border-divider-strong px-4 font-semibold text-white transition hover:bg-surface-hover";
  return (
    <div>
      <iframe
        key={current.url}
        ref={frame}
        src={withApi(current.url)}
        title={title}
        onLoad={handleLoad}
        className="aspect-video w-full rounded-2xl border-0 bg-black"
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-presentation"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2.5 text-sm text-text-secondary">
        <span role="status" className="mr-auto">
          Playing from {current.provider}
          {list.length > 1 && ` (${index + 1} of ${list.length})`}. Not working?
        </span>
        {next && (
          <button type="button" onClick={() => setIndex(index + 1)} className={button}>
            Try {next.provider}
          </button>
        )}
        <button type="button" onClick={onUseLibrary} className={button}>
          Play from the library
        </button>
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
