import { useEffect, useRef } from "react";
import type { ExploreItem, ExploreRow as Row, ExploreService } from "../../lib/explore";

const DRIFT_PX_PER_FRAME = 0.45;

/** Rows drift slowly on their own, back and forth (odd rows start from the other end), so the page
 * feels alive to someone with no idea what to watch. A row stops the moment a pointer, a finger or
 * the keyboard is in it, while it's off screen, and never moves at all for anyone whose system asks
 * for reduced motion. */
function useDrift(ref: React.RefObject<HTMLDivElement | null>, reverse: boolean, enabled: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let paused = false;
    let visible = false;
    let raf = 0;
    let dir = reverse ? -1 : 1;
    let pos: number | null = null;

    const step = () => {
      raf = 0;
      if (paused || !visible) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max > 0) {
        if (pos === null) pos = reverse ? max : el.scrollLeft;
        pos += dir * DRIFT_PX_PER_FRAME;
        if (pos >= max) {
          pos = max;
          dir = -1;
        } else if (pos <= 0) {
          pos = 0;
          dir = 1;
        }
        el.scrollLeft = pos;
      }
      raf = requestAnimationFrame(step);
    };
    const run = () => {
      if (!raf && !paused && visible) raf = requestAnimationFrame(step);
    };
    const pause = () => {
      paused = true;
      cancelAnimationFrame(raf);
      raf = 0;
    };
    // Carries on from wherever the viewer left it.
    const resume = () => {
      paused = false;
      pos = el.scrollLeft;
      run();
    };
    const onFocusOut = (e: FocusEvent) => {
      if (!el.contains(e.relatedTarget as Node | null)) resume();
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      run();
    });
    observer.observe(el);
    el.addEventListener("pointerenter", pause);
    el.addEventListener("pointerleave", resume);
    el.addEventListener("pointerdown", pause);
    el.addEventListener("focusin", pause);
    el.addEventListener("focusout", onFocusOut);
    // A touch scroll has no pointerleave; it picks up again a little after the finger lifts.
    let touchTimer = 0;
    const onTouchEnd = () => {
      window.clearTimeout(touchTimer);
      touchTimer = window.setTimeout(resume, 4000);
    };
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(touchTimer);
      observer.disconnect();
      el.removeEventListener("pointerenter", pause);
      el.removeEventListener("pointerleave", resume);
      el.removeEventListener("pointerdown", pause);
      el.removeEventListener("focusin", pause);
      el.removeEventListener("focusout", onFocusOut);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [ref, reverse, enabled]);
}

function Star({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 2.5l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.6l-5.9 3.1 1.2-6.6L2.5 9.5l6.6-.9z" />
    </svg>
  );
}

export { Star };

function PosterCard({
  item,
  services,
  onOpen,
}: {
  item: ExploreItem;
  services: Map<number, ExploreService>;
  onOpen: (item: ExploreItem) => void;
}) {
  const logos = item.services.map((id) => services.get(id)).filter((s): s is ExploreService => Boolean(s?.logoUrl));
  const kind = item.tmdbType === "tv" ? "Series" : "Film";
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      aria-label={`${item.title}${item.year ? ` (${item.year})` : ""}, ${kind}${item.inLibrary ? ", in Campfire" : ""}`}
      className="group w-[140px] shrink-0 text-left sm:w-[160px]"
    >
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl border border-divider bg-surface transition group-hover:border-divider-strong group-focus-visible:ring-2 group-focus-visible:ring-accent">
        {item.posterUrl && (
          <img
            src={item.posterUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]"
          />
        )}
        {item.inLibrary && (
          <span className="absolute left-2 top-2 rounded-md bg-live px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-background">
            IN CAMPFIRE
          </span>
        )}
        {logos.length > 0 && (
          <div className="absolute bottom-2 right-2 flex gap-1">
            {logos.slice(0, 3).map((s) => (
              <img key={s.id} src={s.logoUrl!} alt="" className="h-5.5 w-5.5 rounded-md shadow-[0_1px_5px_rgba(0,0,0,0.7)]" />
            ))}
          </div>
        )}
      </div>
      <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-[13px] font-semibold leading-tight text-white">{item.title}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-text-secondary">
        {item.rating !== null && (
          <span className="inline-flex items-center gap-0.5 text-foreground">
            <Star className="h-2.5 w-2.5 text-amber" />
            {item.rating.toFixed(1)}
          </span>
        )}
        <span>{[item.year, kind].filter(Boolean).join(" · ")}</span>
      </p>
    </button>
  );
}

export default function ExploreRow({
  row,
  index,
  services,
  onOpen,
}: {
  row: Row;
  index: number;
  services: Map<number, ExploreService>;
  onOpen: (item: ExploreItem) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useDrift(scroller, index % 2 === 1, row.items.length > 4);

  const page = (dir: 1 | -1) => {
    const el = scroller.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  const headingId = `explore-row-${row.id}`;
  return (
    <section aria-labelledby={headingId} className="group/row relative py-4">
      <div className="flex items-baseline gap-2.5 px-4 pb-3 sm:px-6 lg:px-8">
        <h3 id={headingId} className="font-display text-2xl tracking-wide text-white">
          {row.title}
        </h3>
        <span className="text-xs text-text-tertiary">
          {row.items.length} {row.items.length === 1 ? "title" : "titles"}
        </span>
      </div>
      <div className="relative">
        <div ref={scroller} className="overflow-x-auto px-4 pb-2 pt-1 [scrollbar-width:none] sm:px-6 lg:px-8">
          <div className="flex w-max gap-4">
            {row.items.map((item) => (
              <PosterCard key={`${item.tmdbType}-${item.tmdbId}`} item={item} services={services} onOpen={onOpen} />
            ))}
          </div>
        </div>
        {(
          [
            [-1, "left-1", "Scroll back", "M15 18l-6-6 6-6"],
            [1, "right-1", "Scroll on", "M9 18l6-6-6-6"],
          ] as const
        ).map(([dir, side, label, path]) => (
          <button
            key={dir}
            type="button"
            onClick={() => page(dir)}
            aria-label={`${label}: ${row.title}`}
            className={`absolute ${side} top-[34%] hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-divider-strong bg-background/85 text-white opacity-0 shadow-lg transition hover:bg-surface-hover focus-visible:opacity-100 group-hover/row:opacity-100 md:grid`}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path d={path} />
            </svg>
          </button>
        ))}
      </div>
    </section>
  );
}
