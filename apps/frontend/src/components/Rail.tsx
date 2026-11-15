import { useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { PAGE_X } from "../lib/layout";

/** A horizontal rail of cards with an eyebrow, an optional "See all" into the filterable grid, and
 * scroll buttons on pointer devices. The track itself scrolls by wheel, trackpad and touch. */
export default function Rail({
  title,
  eyebrow,
  seeAllHref,
  seeAllLabel = "See all",
  children,
}: {
  title: string;
  eyebrow?: string;
  seeAllHref?: string;
  seeAllLabel?: string;
  children: ReactNode;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  const scrollBy = (direction: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: direction * Math.max(240, track.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <section className={`${PAGE_X} py-4`}>
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          {eyebrow && (
            <p className="font-display text-xs tracking-[0.16em] text-text-tertiary uppercase">{eyebrow}</p>
          )}
          <h2 className="font-display text-2xl tracking-wide text-white">{title}</h2>
        </div>
        <div className="flex items-center gap-1">
          {seeAllHref && (
            <Link
              to={seeAllHref}
              className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-text-secondary transition hover:bg-surface hover:text-accent"
            >
              {seeAllLabel} ›
            </Link>
          )}
          <div className="hidden gap-1 sm:flex">
            <button
              type="button"
              onClick={() => scrollBy(-1)}
              aria-label={`Scroll ${title} left`}
              className="grid h-9 w-9 place-items-center rounded-full border border-divider-strong text-text-secondary transition hover:border-text-tertiary hover:text-white"
            >
              <span aria-hidden="true">‹</span>
            </button>
            <button
              type="button"
              onClick={() => scrollBy(1)}
              aria-label={`Scroll ${title} right`}
              className="grid h-9 w-9 place-items-center rounded-full border border-divider-strong text-text-secondary transition hover:border-text-tertiary hover:text-white"
            >
              <span aria-hidden="true">›</span>
            </button>
          </div>
        </div>
      </div>
      <div
        ref={trackRef}
        className="no-scrollbar flex snap-x gap-4 overflow-x-auto overscroll-x-contain pb-2"
      >
        {children}
      </div>
    </section>
  );
}

/** One slot in a rail — fixed card width, so every rail shares one rhythm. */
export function RailItem({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className={`shrink-0 snap-start ${wide ? "w-[260px] sm:w-[320px]" : "w-[150px] sm:w-[176px]"}`}>
      {children}
    </div>
  );
}
