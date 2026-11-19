import { useAuthedImage } from "../hooks/useAuthedImage";
import type { UpNextItem } from "../lib/upNext";
import { upNextCountdownSeconds } from "../lib/upNext";

function Thumb({ item, className }: { item: UpNextItem; className?: string }) {
  const { url } = useAuthedImage(item.imagePath);
  return (
    <div className={`relative aspect-video overflow-hidden rounded-md bg-surface ${className ?? ""}`}>
      {url && <img src={url} alt="" className="h-full w-full object-cover" />}
    </div>
  );
}

type CardProps = {
  item: UpNextItem;
  /** Seconds still to go; null when nothing is counting down. */
  secondsLeft: number | null;
  askStillWatching: boolean;
  autoplay: boolean;
  onAutoplayChange: (on: boolean) => void;
  onPlay: () => void;
  onDismiss: () => void;
};

/** The corner card near the end: the next episode, or the library's best match after a film or a
 * finale. Its Play button fills up as it counts down — the same card as the apps' (up_next.dart). */
export function UpNextCard({ item, secondsLeft, askStillWatching, autoplay, onAutoplayChange, onPlay, onDismiss }: CardProps) {
  const label = item.kind === "episode" ? "Up next" : "Recommended for you";
  const status =
    secondsLeft != null ? `${label} · in ${Math.ceil(secondsLeft)}s` : askStillWatching ? "Still watching?" : label;
  const total = upNextCountdownSeconds(item);
  const filled = secondsLeft == null ? 100 : Math.min(100, Math.max(0, (1 - secondsLeft / total) * 100));
  const playLabel = askStillWatching ? "Keep watching" : item.kind === "episode" ? "Play next" : "Play now";

  return (
    <div
      className="w-[min(360px,calc(100%-2rem))] rounded-xl border border-divider-strong bg-[#161412]/95 p-3 shadow-2xl backdrop-blur"
      role="region"
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-3">
        <Thumb item={item} className="w-32 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-extrabold uppercase tracking-wider text-accent" aria-live="polite">
            {status}
          </p>
          <p className="mt-1 line-clamp-2 text-sm font-bold leading-tight text-white">{item.title}</p>
          {item.subtitle && <p className="mt-0.5 truncate text-xs text-text-secondary">{item.subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Hide up next"
          title="Not now"
          className="rounded-full p-1 text-text-secondary transition hover:bg-white/10 hover:text-white"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2}>
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {askStillWatching && (
        <p className="mt-2.5 text-xs leading-snug text-text-secondary">
          Two played in a row on their own, so this one waits for you.
        </p>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={onPlay}
          aria-label={`${playLabel}: ${item.title}`}
          className="relative h-9 flex-1 overflow-hidden rounded-full bg-white/20 text-sm font-bold text-white transition hover:brightness-110"
        >
          <span className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${filled}%` }} aria-hidden />
          <span className="relative flex items-center justify-center gap-1.5">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
            {playLabel}
          </span>
        </button>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-text-secondary">
          Autoplay
          <input
            type="checkbox"
            role="switch"
            checked={autoplay}
            onChange={(e) => onAutoplayChange(e.target.checked)}
            className="peer sr-only"
          />
          <span
            aria-hidden
            className="relative h-5 w-9 rounded-full bg-white/20 transition peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-white after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4"
          />
        </label>
      </div>
    </div>
  );
}

function Tile({ item, prominent, onPlay }: { item: UpNextItem; prominent?: boolean; onPlay: () => void }) {
  return (
    <button
      type="button"
      onClick={onPlay}
      aria-label={`Play ${item.title}`}
      className={`group shrink-0 text-left ${prominent ? "w-[min(420px,100%)]" : "w-56 lg:w-64"}`}
    >
      <div className="relative">
        <Thumb item={item} className="transition group-hover:brightness-110" />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="rounded-full bg-black/60 p-2.5 transition group-hover:bg-accent">
            <svg viewBox="0 0 24 24" className="h-6 w-6 text-white" fill="currentColor" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </span>
      </div>
      <p className={`mt-2 truncate font-bold text-white ${prominent ? "text-base" : "text-sm"}`}>{item.title}</p>
      {item.subtitle && <p className="truncate text-xs text-text-secondary">{item.subtitle}</p>}
      {prominent && item.overview && (
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-secondary">{item.overview}</p>
      )}
    </button>
  );
}

type EndProps = {
  upNext: UpNextItem | null;
  suggestions: UpNextItem[];
  askStillWatching: boolean;
  onPlay: (item: UpNextItem) => void;
  onReplay: () => void;
  onBack: () => void;
};

/** Shown when a title ends without moving on: the up-next choice and more like this. */
export function UpNextEndScreen({ upNext, suggestions, askStillWatching, onPlay, onReplay, onBack }: EndProps) {
  const more = suggestions.filter((s) => s.fileId !== upNext?.fileId);
  const heading = askStillWatching ? "Still watching?" : upNext?.kind === "episode" ? "Up next" : "You might like";
  return (
    <div
      className="absolute inset-0 z-20 overflow-y-auto bg-[#0e0d0c]/90 px-4 py-4 sm:px-8 sm:py-7"
      onClick={(e) => e.stopPropagation()}
    >
      <h2 className="font-display text-3xl tracking-wide text-white sm:text-4xl">{heading}</h2>
      {askStillWatching && (
        <p className="mt-1 text-sm text-text-secondary">
          Autoplay paused after two in a row. Pick up where you are, or choose something else.
        </p>
      )}
      {upNext && (
        <div className="mt-4">
          <Tile item={upNext} prominent onPlay={() => onPlay(upNext)} />
        </div>
      )}
      {more.length > 0 && (
        <>
          <p className="mt-6 text-xs font-extrabold uppercase tracking-wider text-text-secondary">More like this</p>
          <div className="mt-2.5 flex gap-3 overflow-x-auto pb-2">
            {more.map((s) => (
              <Tile key={s.fileId} item={s} onPlay={() => onPlay(s)} />
            ))}
          </div>
        </>
      )}
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onReplay}
          className="rounded-full border border-divider-strong px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          ↻ Watch again
        </button>
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-divider-strong px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          ← Back
        </button>
      </div>
    </div>
  );
}
