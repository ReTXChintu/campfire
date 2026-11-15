import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { SpotlightSlide } from "../lib/types";

const AUTO_ADVANCE_MS = 7000;

/** One slide's backdrop. Same ember-radial look as the old single hero, rotated per slide so
 * consecutive slides don't look like a stuck page. */
function backdrop(index: number): string {
  const hue = (index * 37) % 360;
  return `radial-gradient(circle at 75% 30%, hsl(${(18 + hue) % 360} 52% 16%) 0%, hsl(${(330 + hue) % 360} 30% 8%) 40%, #0A0B0F 75%)`;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** The Home spotlight: a snap-scrolling carousel over `library.spotlight`.
 *
 * Accessibility notes, since a carousel is the classic screen-reader trap:
 * - every slide stays in the DOM and in the tab order (no aria-hidden on the off-screen ones), so
 *   a screen reader or a keyboard user can simply walk through all of them in order;
 * - the whole thing is one labelled group with aria-roledescription="carousel", and each slide
 *   says "N of M", so leaving it is never a guess;
 * - auto-advance stops for good the moment someone uses the arrows or the dots, pauses while the
 *   pointer or focus is inside, and never starts at all under prefers-reduced-motion.
 */
export default function SpotlightCarousel({ slides }: { slides: SpotlightSlide[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [interacted, setInteracted] = useState(false);
  const reducedMotion = useReducedMotion();
  const count = slides.length;

  const scrollToIndex = useCallback(
    (next: number, smooth: boolean) => {
      const track = trackRef.current;
      if (!track) return;
      const clamped = ((next % count) + count) % count;
      track.scrollTo({ left: clamped * track.clientWidth, behavior: smooth ? "smooth" : "auto" });
      setIndex(clamped);
    },
    [count],
  );

  /** Any deliberate move (arrow, dot, arrow key) also ends auto-advance — being yanked to the next
   * slide right after choosing one is the single most annoying thing a carousel can do. */
  const goTo = useCallback(
    (next: number) => {
      setInteracted(true);
      scrollToIndex(next, !reducedMotion);
    },
    [reducedMotion, scrollToIndex],
  );

  // Keep the dots honest when the slide changes by swipe/trackpad rather than by our own scrollTo.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!track.clientWidth) return;
        setIndex(Math.round(track.scrollLeft / track.clientWidth));
      });
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      track.removeEventListener("scroll", onScroll);
    };
  }, []);

  useEffect(() => {
    if (reducedMotion || interacted || paused || count < 2) return;
    const timer = window.setInterval(() => {
      const track = trackRef.current;
      if (!track || !track.clientWidth) return;
      const current = Math.round(track.scrollLeft / track.clientWidth);
      const next = (current + 1) % count;
      track.scrollTo({ left: next * track.clientWidth, behavior: "smooth" });
      setIndex(next);
    }, AUTO_ADVANCE_MS);
    return () => window.clearInterval(timer);
  }, [count, interacted, paused, reducedMotion]);

  if (count === 0) return null;

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Spotlight"
      className="relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") {
          event.preventDefault();
          goTo(index + 1);
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          goTo(index - 1);
        }
      }}
    >
      <div
        ref={trackRef}
        className="flex w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
        // The track is scrolled programmatically and by swipe; the slides' own links carry the tab
        // order, so it deliberately isn't an extra tab stop of its own.
        style={{ scrollbarWidth: "none" }}
      >
        {slides.map((slide, i) => (
          <div
            key={`${slide.id}-${i}`}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${count}: ${slide.title}`}
            className="relative flex h-[62vh] min-h-[420px] w-full shrink-0 snap-start snap-always items-end sm:h-[70vh] sm:min-h-[460px]"
            style={{ background: backdrop(i) }}
          >
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent" />
            <div className="relative z-10 max-w-xl px-4 pb-20 sm:px-6 sm:pb-24">
              <div className="mb-4 inline-flex items-center gap-2 rounded border border-amber/30 bg-amber/10 px-2.5 py-1 font-mono text-xs uppercase tracking-wide text-amber">
                {slide.badge}
              </div>
              <h1 className="mb-6 font-display text-5xl leading-[0.9] tracking-wide text-white sm:text-8xl">
                {slide.title}
              </h1>
              <div className="flex flex-wrap gap-3">
                <Link
                  to={slide.playHref}
                  className="flex items-center gap-2 rounded-md bg-white px-6 py-3 text-sm font-bold text-black transition hover:bg-white/90"
                >
                  ▶ Play
                </Link>
                {slide.infoHref && (
                  <Link
                    to={slide.infoHref}
                    className="flex items-center gap-2 rounded-md border border-white/15 bg-white/10 px-6 py-3 text-sm font-bold text-white transition hover:bg-white/15"
                  >
                    More Info
                  </Link>
                )}
                {slide.kind === "request" && slide.requestId && (
                  <Link
                    to={`/requests?request=${encodeURIComponent(slide.requestId)}`}
                    className="flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-bold text-text-secondary transition hover:text-white"
                  >
                    See the request
                  </Link>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {count > 1 && (
        <>
          <button
            type="button"
            onClick={() => goTo(index - 1)}
            aria-label="Previous slide"
            className="absolute left-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black/50 text-white transition hover:bg-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:grid"
          >
            <span aria-hidden="true">‹</span>
          </button>
          <button
            type="button"
            onClick={() => goTo(index + 1)}
            aria-label="Next slide"
            className="absolute right-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black/50 text-white transition hover:bg-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:grid"
          >
            <span aria-hidden="true">›</span>
          </button>

          <div className="absolute bottom-6 left-4 z-10 flex gap-2 sm:left-6">
            {slides.map((slide, i) => (
              <button
                key={`${slide.id}-dot-${i}`}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Show slide ${i + 1}: ${slide.title}`}
                aria-current={i === index}
                className={`h-2 rounded-full transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  i === index ? "w-7 bg-accent" : "w-2 bg-white/35 hover:bg-white/60"
                }`}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
