import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuthedImage } from "../../hooks/useAuthedImage";
import type { ExploreItem } from "../../lib/explore";
import { itemKey, type FeedHeroItem } from "../../lib/feed";
import { PAGE_X } from "../../lib/layout";
import type { SpotlightSlide } from "../../lib/types";
import { Star } from "../explore/ExploreRow";

const ADVANCE_MS = 9000;
const SWIPE_PX = 48;

type Slide =
  | { kind: "title"; key: string; title: string; item: FeedHeroItem }
  /** A requested title that has since been added. */
  | { kind: "added"; key: string; title: string; slide: SpotlightSlide };

function toSlides(hero: FeedHeroItem[], added: SpotlightSlide[]): Slide[] {
  const slides: Slide[] = hero.map((item) => ({ kind: "title", key: itemKey(item), title: item.title, item }));
  // Second, where it's seen; the first is always what everyone is watching.
  const news = added.map((slide): Slide => ({ kind: "added", key: `added-${slide.id}`, title: slide.title, slide }));
  slides.splice(1, 0, ...news);
  return slides;
}

const prefersStill = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const PRIMARY =
  "inline-flex min-h-12 items-center gap-2 rounded-lg bg-white px-6 text-sm font-bold text-black transition hover:bg-white/85";
const SECONDARY =
  "inline-flex min-h-12 items-center gap-2 rounded-lg bg-white/15 px-6 text-sm font-bold text-white backdrop-blur transition hover:bg-white/25";

function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <polygon points="7,4 20,12 7,20" />
    </svg>
  );
}

function Heading({ title, logo }: { title: string; logo: string | null }) {
  return (
    <h2>
      {logo ? (
        <img
          src={logo}
          alt={title}
          className="max-h-24 w-auto max-w-[min(100%,26rem)] object-contain object-left drop-shadow-[0_2px_16px_rgba(0,0,0,0.8)] sm:max-h-40"
        />
      ) : (
        <span className="block font-display text-5xl leading-[0.92] tracking-wide text-white sm:text-7xl">{title}</span>
      )}
    </h2>
  );
}

/** With `play`, opened on the sources to play from. */
type Open = (item: ExploreItem, play?: boolean) => void;

function TitleSlide({ item, onOpen }: { item: FeedHeroItem; onOpen: Open }) {
  return (
    <>
      <Heading title={item.title} logo={item.logoUrl} />
      <p className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-white/85">
        {item.rating !== null && (
          <span className="inline-flex items-center gap-1 font-bold">
            <Star className="h-3.5 w-3.5 text-amber" />
            {item.rating.toFixed(1)}
          </span>
        )}
        {[item.year, item.tmdbType === "tv" ? "Series" : "Film", ...item.genres.slice(0, 2)].filter(Boolean).map((fact) => (
          <span key={fact}>{fact}</span>
        ))}
      </p>
      {item.overview && <p className="mt-3 line-clamp-3 max-w-[60ch] text-sm leading-relaxed text-white/80 sm:text-base">{item.overview}</p>}
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" onClick={() => onOpen(item, true)} className={PRIMARY}>
          <PlayGlyph />
          Play
        </button>
        <button type="button" onClick={() => onOpen(item)} className={SECONDARY}>
          More info
        </button>
      </div>
    </>
  );
}

function AddedSlide({ slide }: { slide: SpotlightSlide }) {
  const { url: logo } = useAuthedImage(slide.logoPath ?? null);
  return (
    <>
      <p className="mb-4 inline-flex rounded border border-live/40 bg-live/15 px-2.5 py-1 text-xs font-semibold text-live">{slide.badge}</p>
      <Heading title={slide.title} logo={logo ?? null} />
      <div className="mt-6 flex flex-wrap gap-3">
        <Link to={slide.playHref} className={PRIMARY}>
          <PlayGlyph />
          Play
        </Link>
        {slide.infoHref && (
          <Link to={slide.infoHref} className={SECONDARY}>
            More info
          </Link>
        )}
      </div>
    </>
  );
}

function AddedArt({ slide }: { slide: SpotlightSlide }) {
  const { url } = useAuthedImage(slide.thumbnailPath);
  return url ? <img src={url} alt="" className="h-full w-full object-cover object-center" /> : null;
}

/**
 * The top of Home: what everyone is watching, filling the screen, with titles people asked for that
 * have since been added in among them.
 *
 * It moves on by itself until someone uses it, pauses under the pointer or keyboard focus, and never
 * starts for anyone whose system asks for reduced motion. Only the slide on show is in the tab order.
 */
export default function FeedHero({
  hero,
  added,
  onOpen,
}: {
  hero: FeedHeroItem[];
  added: SpotlightSlide[];
  onOpen: Open;
}) {
  const slides = toSlides(hero, added);
  const count = slides.length;
  const [at, setAt] = useState(0);
  const [held, setHeld] = useState(false);
  const [used, setUsed] = useState(prefersStill);
  const touchX = useRef<number | null>(null);
  const index = count ? at % count : 0;

  useEffect(() => {
    if (used || held || count < 2) return;
    const timer = window.setTimeout(() => setAt(index + 1), ADVANCE_MS);
    return () => window.clearTimeout(timer);
  }, [used, held, count, index]);

  if (count === 0) return null;
  const go = (to: number) => {
    setUsed(true);
    setAt((to + count) % count);
  };
  const current = slides[index];
  // The pictures either side are fetched ahead; the rest wait until they're near.
  const isNear = (i: number) => i === index || i === (index + 1) % count || i === (index - 1 + count) % count;

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured"
      className="relative h-[78vh] max-h-[880px] min-h-[520px] overflow-hidden bg-background"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      onTouchStart={(event) => (touchX.current = event.touches[0].clientX)}
      onTouchEnd={(event) => {
        const moved = touchX.current === null ? 0 : event.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (Math.abs(moved) > SWIPE_PX) go(index + (moved < 0 ? 1 : -1));
      }}
    >
      {slides.map((slide, i) => (
        <div
          key={slide.key}
          aria-hidden="true"
          className={`absolute inset-0 transition-opacity duration-700 ${i === index ? "opacity-100" : "opacity-0"}`}
        >
          {isNear(i) &&
            (slide.kind === "added" ? (
              <AddedArt slide={slide.slide} />
            ) : (
              <img src={slide.item.backdropUrl!} alt="" className="h-full w-full object-cover object-[center_20%]" />
            ))}
        </div>
      ))}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-background/90 via-background/35 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-background via-background/60 to-transparent" />

      <div
        key={current.key}
        role="group"
        aria-roledescription="slide"
        aria-label={`${index + 1} of ${count}: ${current.title}`}
        className={`absolute inset-x-0 bottom-20 sm:bottom-24 ${PAGE_X}`}
      >
        <div className="max-w-2xl">
          {current.kind === "added" ? <AddedSlide slide={current.slide} /> : <TitleSlide item={current.item} onOpen={onOpen} />}
        </div>
      </div>

      {count > 1 && (
        <div className={`absolute inset-x-0 bottom-7 flex items-center justify-between gap-4 ${PAGE_X}`}>
          <div className="flex">
            {slides.map((slide, i) => (
              <button
                key={slide.key}
                type="button"
                onClick={() => go(i)}
                aria-label={`Show ${slide.title}`}
                aria-current={i === index}
                className="group grid h-8 place-items-center px-1"
              >
                <span
                  className={`block h-1 rounded-full transition-all ${i === index ? "w-9 bg-accent" : "w-5 bg-white/35 group-hover:bg-white/70"}`}
                />
              </button>
            ))}
          </div>
          <div className="hidden gap-2 sm:flex">
            {([-1, 1] as const).map((by) => (
              <button
                key={by}
                type="button"
                onClick={() => go(index + by)}
                aria-label={by < 0 ? "Previous" : "Next"}
                className="grid h-11 w-11 place-items-center rounded-full bg-white/15 text-lg text-white backdrop-blur transition hover:bg-white/30"
              >
                <span aria-hidden="true">{by < 0 ? "‹" : "›"}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
