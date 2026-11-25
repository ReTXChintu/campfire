import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { exploreMetaLine, libraryHref, titleParam, useExploreTitle, type ExploreDetail as Detail } from "../../lib/explore";
import { Skeleton } from "../ui/States";
import OpinionButtons from "../OpinionButtons";
import EpisodeList from "./EpisodeList";
import SourceMenu from "./SourceMenu";
import WhereToWatch from "./WhereToWatch";
import { useSeriesEpisodes } from "../../lib/play";
import { itemKey, useSimilarTitles } from "../../lib/feed";
import { trailerSrc, useTrailer } from "../../lib/trailer";
import { Star } from "./ExploreRow";

/** One title opened: what it is, its trailer, where it streams in India, and — when it isn't in
 * Campfire — a way to ask for it. A modal over the page (the whole screen on a phone), closed by
 * Escape, a click outside it, or Back. */
export default function ExploreDetail({
  type,
  tmdbId,
  onClose,
}: {
  type: "movie" | "tv";
  tmdbId: string;
  onClose: () => void;
}) {
  const query = useExploreTitle(type, tmdbId);
  const closeButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      // Keeps Tab inside the panel while it's open.
      if (e.key === "Tab" && panel.current) {
        const focusable = panel.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), iframe");
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, [onClose]);

  const d = query.data;
  // Opened by a Play button elsewhere.
  const [params] = useSearchParams();
  return (
    // The whole layer scrolls, so a long title's details do too, with the page still behind it.
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/75 backdrop-blur-[2px]">
      <div className="relative min-h-full sm:py-[4vh]">
        <button type="button" aria-label="Close details" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default" />
        <section
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby="explore-detail-title"
          className="detail-in relative mx-auto min-h-dvh w-full overflow-hidden bg-[var(--bg-elevated)] shadow-[0_30px_90px_rgba(0,0,0,0.8)] sm:min-h-[70vh] sm:w-[90%] sm:rounded-2xl"
        >
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 z-20 grid h-11 w-11 place-items-center rounded-full bg-black/70 text-white ring-1 ring-white/20 transition hover:bg-black"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          {d ? (
            <DetailBody d={d} startChoosing={params.get("play") === "1"} />
          ) : query.isError ? (
            <div className="p-6 pt-16 sm:p-12">
              <h2 id="explore-detail-title" className="font-display text-3xl text-white">
                That didn't load
              </h2>
              <p className="mt-2 text-sm text-text-secondary">TMDb isn't answering right now. Try again in a minute.</p>
              <button
                type="button"
                onClick={() => query.refetch()}
                className="mt-4 min-h-11 rounded-lg border border-divider-strong px-4 text-sm font-semibold text-white hover:bg-surface-hover"
              >
                Retry
              </button>
            </div>
          ) : (
            <div role="status" aria-label="Loading">
              <h2 id="explore-detail-title" className="sr-only">
                Loading
              </h2>
              <Skeleton className={`w-full rounded-none ${HERO}`} />
              <div className={`grid gap-4 py-8 ${GUTTER}`}>
                <Skeleton className="h-9 w-2/5" />
                <Skeleton className="h-4 w-1/4" />
                <Skeleton className="h-28 w-3/5" />
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

const HEADING = "font-display text-2xl tracking-wide text-white";
const HERO = "aspect-[4/3] sm:aspect-video sm:max-h-[72vh]";
const GUTTER = "px-4 sm:px-8 lg:px-12";

/** Opens another title in this same modal. It replaces the one open in the history, so Back still
 * closes the modal rather than walking back through every title looked at. */
function MoreLikeThis({ d }: { d: Detail }) {
  const { data } = useSimilarTitles(d.tmdbType, d.tmdbId);
  const [params] = useSearchParams();
  const location = useLocation();
  if (!data?.length) return null;
  const hrefOf = (type: "movie" | "tv", id: string) => {
    const next = new URLSearchParams(params);
    next.set("title", titleParam(type, id));
    next.delete("play");
    return `?${next}`;
  };
  return (
    <section aria-labelledby="explore-more-heading" className="grid gap-3">
      <h3 id="explore-more-heading" className={HEADING}>
        More like this
      </h3>
      <ul className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 lg:grid-cols-6">
        {data.map((item) => (
          <li key={itemKey(item)} className="min-w-0">
            <Link to={hrefOf(item.tmdbType, item.tmdbId)} replace state={location.state} className="group grid gap-1.5">
              <span className="relative block aspect-[2/3] overflow-hidden rounded-xl bg-surface ring-1 ring-divider transition group-hover:ring-2 group-hover:ring-white/70">
                {item.posterUrl && <img src={item.posterUrl} alt="" loading="lazy" className="h-full w-full object-cover" />}
                {item.inLibrary && (
                  <span className="absolute left-1.5 top-1.5 rounded-md bg-live px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-background">
                    IN LIBRARY
                  </span>
                )}
              </span>
              <span className="line-clamp-2 text-[13px] font-semibold leading-tight text-white">{item.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

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

/** The artwork across the top, with the title and what to do about it; the trailer plays in its place. */
function DetailHero({
  d,
  playing,
  onPlay,
  choosing,
  onChoose,
}: {
  d: Detail;
  playing: boolean;
  onPlay: () => void;
  choosing: boolean;
  onChoose: () => void;
}) {
  const { data: trailer } = useTrailer({ type: d.tmdbType, id: d.tmdbId });
  const art = d.backdropUrl ?? d.posterUrl;
  const { data: series } = useSeriesEpisodes(d.tmdbType === "tv" ? d.tmdbId : null, null);
  const at = series && `S${series.resume.season} E${series.resume.episode}`;
  const play = at ? `${series.resume.started ? "Resume" : "Play"} ${at}` : "Play";
  return (
    <div className={`relative w-full overflow-hidden bg-black ${HERO}`}>
      {playing && trailer ? (
        <>
          <h2 id="explore-detail-title" className="sr-only">
            {d.title}
          </h2>
          <iframe
            src={trailerSrc(trailer)}
            title={trailer.name}
            className="h-full w-full border-0"
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation"
          />
        </>
      ) : (
        <>
          {art && <img src={art} alt="" className="h-full w-full object-cover object-[center_25%]" />}
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-elevated)] via-[rgba(22,20,18,0.35)] to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/60 to-transparent to-60%" />
          <div className={`absolute inset-x-0 bottom-6 sm:bottom-10 ${GUTTER}`}>
            <h2 id="explore-detail-title">
              {d.logoUrl ? (
                <img
                  src={d.logoUrl}
                  alt={d.title}
                  className="max-h-20 w-auto max-w-[70%] object-contain object-left drop-shadow-[0_2px_16px_rgba(0,0,0,0.8)] sm:max-h-36 sm:max-w-[26rem]"
                />
              ) : (
                <span className="block font-display text-4xl leading-[0.95] text-white sm:text-7xl">{d.title}</span>
              )}
            </h2>
            <div className="mt-5 flex flex-wrap gap-3">
              {/* On every title: whether a source has it is only known by trying it. */}
              <button type="button" onClick={onChoose} aria-expanded={choosing} className={PRIMARY}>
                <PlayGlyph />
                {play}
              </button>
              {trailer && (
                <button type="button" onClick={onPlay} className={SECONDARY}>
                  Trailer
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function DetailBody({ d, startChoosing }: { d: Detail; startChoosing: boolean }) {
  const [playing, setPlaying] = useState(false);
  const [choosing, setChoosing] = useState(startChoosing);
  return (
    <>
      <DetailHero
        d={d}
        playing={playing}
        onPlay={() => setPlaying(true)}
        choosing={choosing}
        onChoose={() => setChoosing((open) => !open)}
      />
      <div className={`grid gap-10 pb-12 pt-5 ${GUTTER}`}>
        {choosing && <SourceMenu title={{ type: d.tmdbType, id: d.tmdbId }} headingClass={HEADING} />}
        <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
          <div className="grid min-w-0 content-start gap-4">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary">
              {d.rating !== null && (
                <span className="inline-flex items-center gap-1 font-bold text-foreground">
                  <Star className="h-3.5 w-3.5 text-amber" />
                  {d.rating.toFixed(1)}
                </span>
              )}
              <span>{exploreMetaLine(d)}</span>
              {d.genres.length > 0 && <span>{d.genres.join(", ")}</span>}
              {d.inLibrary && (
                <Link to={libraryHref(d.inLibrary)} className="font-semibold text-live underline-offset-2 hover:underline">
                  In your library
                </Link>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <OpinionButtons title={{ type: d.tmdbType, id: d.tmdbId }} />
              {playing && (
                <button
                  type="button"
                  onClick={() => setPlaying(false)}
                  className="min-h-11 rounded-lg border border-divider-strong px-3.5 text-sm font-semibold text-white transition hover:bg-surface-hover"
                >
                  Close trailer
                </button>
              )}
            </div>
            {d.tagline && <p className="text-base italic text-text-tertiary">{d.tagline}</p>}
            {d.overview && <p className="max-w-[80ch] text-base leading-relaxed text-[#d8d1c6]">{d.overview}</p>}

            {d.cast.length > 0 && (
              <section aria-labelledby="explore-cast-heading" className="mt-3 grid gap-3">
                <h3 id="explore-cast-heading" className={HEADING}>
                  Cast
                </h3>
                <ul className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                  {d.cast.map((person, i) => (
                    <li key={`${person.name}-${i}`} className="flex min-w-0 items-center gap-3">
                      {person.profileUrl ? (
                        <img src={person.profileUrl} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded-full bg-surface object-cover object-top" />
                      ) : (
                        <span className="h-14 w-14 shrink-0 rounded-full bg-surface" aria-hidden="true" />
                      )}
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold leading-tight text-white">{person.name}</span>
                        {person.character && (
                          <span className="mt-0.5 line-clamp-2 block text-xs leading-tight text-text-tertiary">{person.character}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <WhereToWatch d={d} />
        </div>

        {d.tmdbType === "tv" && <EpisodeList seriesId={d.tmdbId} headingClass={HEADING} />}

        <MoreLikeThis d={d} />

        <p className="text-[11px] text-text-tertiary">
          Availability from JustWatch, via TMDB. "Open" takes you to that service's own site.{" "}
          <a href={d.watch.link ?? d.link} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-text-secondary">
            See it on TMDB
          </a>
        </p>
      </div>
    </>
  );
}
