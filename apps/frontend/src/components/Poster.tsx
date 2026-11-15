import type { ReactNode } from "react";
import { useAuthedImage } from "../hooks/useAuthedImage";

/** Deterministic hue per id, so a title without artwork always gets the same placeholder colour —
 * a stable colour reads as identity, a random one as noise. (Same function the request posters
 * use.) */
function hueFor(key: string): number {
  let n = 0;
  for (let i = 0; i < key.length; i++) n = (n * 31 + key.charCodeAt(i)) % 360;
  return (n * 7) % 360;
}

function initialFor(title: string): string {
  return (title.replace(/^(the|a|an)\s+/i, "").trim().charAt(0) || "?").toUpperCase();
}

/** Asks the thumbnail routes for a 2:3 poster (TMDb's, when the title is matched; otherwise the
 * route just returns its usual image). */
function posterPath(path: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}shape=poster`;
}

/**
 * The artwork frame every card, rail and detail header shares.
 *
 * `poster` mode (2:3) asks for the title's TMDb poster; `still` mode (16:9) gets the backdrop or
 * Drive frame and is used where the shape is naturally wide: continue-watching and episode rows.
 * Either way the image fills the frame, cropped around its centre — an image of the other shape
 * (an unmatched title's Drive frame in a poster card) loses its edges, never gets bars.
 */
export default function Poster({
  path,
  title,
  id,
  ratio = "poster",
  className = "",
  children,
}: {
  /** A backend image path (`/api/thumbnail/<id>`), or null when there's nothing to load. */
  path: string | null;
  title: string;
  /** Used only to pick the placeholder hue. */
  id: string;
  ratio?: "poster" | "still";
  className?: string;
  /** Badges, progress bars and hover affordances, absolutely positioned over the frame. */
  children?: ReactNode;
}) {
  const { url, failed } = useAuthedImage(path && ratio === "poster" ? posterPath(path) : path);
  const shape = ratio === "poster" ? "aspect-[2/3]" : "aspect-video";
  const hue = hueFor(id);

  return (
    <div
      className={`relative w-full overflow-hidden rounded-xl border border-divider bg-surface ${shape} ${className}`}
      style={
        !url
          ? {
              background: `linear-gradient(160deg, hsl(${hue} 46% 26%) 0%, hsl(${hue} 34% 13%) 55%, #0c0b0a 100%)`,
            }
          : undefined
      }
    >
      {url ? (
        <img
          src={url}
          alt={title}
          className="absolute inset-0 h-full w-full object-cover object-center transition duration-300 ease-out group-hover:scale-105"
        />
      ) : failed || !path ? (
        <div className="absolute inset-0 grid place-items-center">
          <span className="font-display text-5xl leading-none tracking-wide text-white/15" aria-hidden="true">
            {initialFor(title)}
          </span>
        </div>
      ) : (
        <div className="skeleton absolute inset-0" aria-hidden="true" />
      )}
      {children}
    </div>
  );
}

/** The quality/format chip that sits on the artwork. */
export function PosterBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" | "live" }) {
  const tones = {
    neutral: "border-divider-strong text-white",
    warn: "border-amber/45 text-amber",
    live: "border-live/45 text-live",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border bg-black/65 px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase backdrop-blur-sm ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** The watch-progress bar pinned to the bottom of the artwork — green and full once finished. */
export function PosterProgress({ percent, done = false }: { percent: number; done?: boolean }) {
  return (
    <div className="absolute inset-x-0 bottom-0 h-1 bg-black/60">
      <div
        className={`h-full ${done ? "bg-live" : "bg-accent"}`}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

/**
 * The hover/focus affordance on a card. It is deliberately **not** a button: the whole card is one
 * link, and this shows what that link does (Play, or Open) rather than adding a second control.
 */
export function PosterAction({ label }: { label: string }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 flex translate-y-1.5 items-center gap-2 bg-gradient-to-t from-black/90 to-transparent p-2 opacity-0 transition duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100"
    >
      <span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-black">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          <polygon points="8,5 19,12 8,19" />
        </svg>
      </span>
      <span className="text-xs font-bold text-white">{label}</span>
    </div>
  );
}
