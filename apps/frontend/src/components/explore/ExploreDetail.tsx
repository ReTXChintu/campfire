import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { exploreMetaLine, libraryHref, useExploreTitle, type ExploreDetail as Detail, type ExploreOffer } from "../../lib/explore";
import { useCreateRequest, useToggleUpvote } from "../../hooks/useRequests";
import { Skeleton } from "../ui/States";
import Trailer from "../Trailer";
import { Star } from "./ExploreRow";

/** One title opened: what it is, where it streams in India, and — when it isn't in Campfire — a
 * way to ask for it. A side panel over the page, closed by Escape, the backdrop or Back. */
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
        const focusable = panel.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
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
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close details"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/70"
      />
      <aside
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="explore-detail-title"
        className="relative h-full w-full overflow-y-auto border-l border-divider bg-[var(--bg-elevated)] shadow-[-24px_0_60px_rgba(0,0,0,0.5)] sm:w-[520px]"
      >
        <button
          ref={closeButton}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 grid h-10 w-10 place-items-center rounded-full border border-divider-strong bg-background/80 text-white transition hover:bg-surface-hover"
        >
          <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        {d ? (
          <DetailBody d={d} />
        ) : query.isError ? (
          <div className="p-6 pt-16">
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
          <div role="status" aria-label="Loading" className="grid gap-4">
            <h2 id="explore-detail-title" className="sr-only">
              Loading
            </h2>
            <Skeleton className="h-[220px] w-full rounded-none" />
            <div className="grid gap-3 px-6">
              <Skeleton className="h-9 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function OfferRow({ offer }: { offer: ExploreOffer }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-divider bg-surface px-3 py-2.5">
      {offer.logoUrl ? (
        <img src={offer.logoUrl} alt="" className="h-9 w-9 rounded-lg" />
      ) : (
        <span className="h-9 w-9 rounded-lg bg-surface-hover" aria-hidden="true" />
      )}
      <span className="flex-1 text-sm font-semibold text-white">{offer.name}</span>
      <a
        href={offer.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open on ${offer.name} (opens in a new tab)`}
        className="inline-flex min-h-9 items-center rounded-lg border border-divider-strong px-3.5 text-[13px] font-semibold text-white transition hover:bg-surface-hover"
      >
        Open
      </a>
    </div>
  );
}

function OfferChips({ offers }: { offers: ExploreOffer[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {offers.map((o) => (
        <a
          key={o.id}
          href={o.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-full border border-divider bg-surface py-1.5 pl-1.5 pr-3 text-[13px] font-semibold text-white transition hover:bg-surface-hover"
        >
          {o.logoUrl && <img src={o.logoUrl} alt="" className="h-6 w-6 rounded-full" />}
          {o.name}
        </a>
      ))}
    </div>
  );
}

function RequestBlock({ d }: { d: Detail }) {
  const create = useCreateRequest();
  const vote = useToggleUpvote();
  const existing = d.existingRequest;
  const error = create.error ?? vote.error;

  if (existing?.iWantIt || create.isSuccess) {
    const others = existing ? existing.wantCount - 1 : 0;
    return (
      <p role="status" className="rounded-xl border border-amber/35 bg-amber/[0.08] px-4 py-3 text-sm text-amber">
        You've asked for this — it's on the{" "}
        <Link to="/requests" className="font-semibold underline underline-offset-2">
          requests board
        </Link>
        {others > 0 ? ` with ${others} other ${others === 1 ? "vote" : "votes"}` : ""}.
      </p>
    );
  }
  if (existing) {
    return (
      <div className="grid gap-2">
        <p className="text-sm text-text-secondary">
          {existing.wantCount} {existing.wantCount === 1 ? "person has" : "people have"} already asked for this.
        </p>
        <button
          type="button"
          disabled={vote.isPending}
          onClick={() => vote.mutate({ id: existing.id, wantsIt: true })}
          className="min-h-11 justify-self-start rounded-lg bg-accent px-5 text-sm font-bold text-background transition hover:brightness-110 disabled:opacity-60"
        >
          {vote.isPending ? "Adding…" : "Add my vote"}
        </button>
        {error && <p className="text-sm text-danger">{error.message}</p>}
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      <button
        type="button"
        disabled={create.isPending}
        onClick={() => create.mutate({ title: d.title, refLink: d.link })}
        className="min-h-11 justify-self-start rounded-lg border border-accent px-5 text-sm font-bold text-[#ff8a63] transition hover:bg-accent-soft disabled:opacity-60"
      >
        {create.isPending ? "Requesting…" : "Request on Campfire"}
      </button>
      <p className="text-xs text-text-tertiary">Goes on the requests board with this title's TMDb link, so it's exactly this one.</p>
      {error && <p className="text-sm text-danger">{error.message}</p>}
    </div>
  );
}

function DetailBody({ d }: { d: Detail }) {
  const nowhere = !d.watch.stream.length && !d.watch.free.length && !d.watch.rentBuy.length;
  return (
    <>
      {d.backdropUrl ? (
        <div className="relative h-[220px]">
          <img src={d.backdropUrl} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-elevated)] to-transparent to-60%" />
        </div>
      ) : (
        <div className="h-14" />
      )}
      <div className="grid gap-5 px-6 pb-8 pt-5">
        <div className="flex items-start gap-4">
          {d.posterUrl && (
            <img src={d.posterUrl} alt="" className="h-[156px] w-[104px] shrink-0 rounded-xl border border-divider object-cover" />
          )}
          <div className="grid min-w-0 gap-2">
            <span className="text-[11px] font-bold tracking-[0.12em] text-text-tertiary">{d.tmdbType === "tv" ? "SERIES" : "FILM"}</span>
            <h2 id="explore-detail-title" className="font-display text-4xl leading-[0.95] text-white">
              {d.title}
            </h2>
            <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-text-secondary">
              {d.rating !== null && (
                <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                  <Star className="h-3 w-3 text-amber" />
                  {d.rating.toFixed(1)}
                </span>
              )}
              <span>{exploreMetaLine(d)}</span>
            </p>
            {d.genres.length > 0 && <p className="text-[13px] text-text-tertiary">{d.genres.join(" · ")}</p>}
          </div>
        </div>

        {d.tagline && <p className="text-sm italic text-text-tertiary">{d.tagline}</p>}
        {d.overview && <p className="text-sm leading-relaxed text-[#d8d1c6]">{d.overview}</p>}

        {d.inLibrary && (
          <div className="grid gap-2.5 rounded-xl border border-live/35 bg-live/[0.08] p-4">
            <span className="text-[13px] font-semibold text-live">In your Campfire library</span>
            <Link
              to={libraryHref(d.inLibrary)}
              className="inline-flex min-h-11 items-center justify-self-start rounded-lg bg-accent px-5 text-sm font-bold text-background transition hover:brightness-110"
            >
              {d.inLibrary.kind === "folder" ? "Open in Campfire" : "Play in Campfire"}
            </Link>
          </div>
        )}

        <Trailer tmdb={{ type: d.tmdbType, id: d.tmdbId }} />

        <section aria-labelledby="explore-watch-heading" className="grid gap-3">
          <h3 id="explore-watch-heading" className="text-[13px] font-bold tracking-[0.1em] text-text-secondary">
            WHERE TO WATCH IN INDIA
          </h3>
          {d.watch.stream.length > 0 && (
            <div className="grid gap-2">
              <span className="text-xs text-text-tertiary">Stream with a subscription</span>
              {d.watch.stream.map((o) => (
                <OfferRow key={o.id} offer={o} />
              ))}
            </div>
          )}
          {d.watch.free.length > 0 && (
            <div className="grid gap-2">
              <span className="text-xs text-text-tertiary">Free</span>
              {d.watch.free.map((o) => (
                <OfferRow key={o.id} offer={o} />
              ))}
            </div>
          )}
          {d.watch.rentBuy.length > 0 && (
            <div className="grid gap-2">
              <span className="text-xs text-text-tertiary">Rent or buy</span>
              <OfferChips offers={d.watch.rentBuy} />
            </div>
          )}
          {nowhere && (
            <p className="rounded-xl border border-divider bg-surface px-4 py-3.5 text-sm leading-relaxed text-text-secondary">
              Not streaming anywhere in India right now.
              {!d.inLibrary && " Ask for it on Campfire and it lands on the requests board."}
            </p>
          )}
        </section>

        {!d.inLibrary && <RequestBlock d={d} />}

        {d.cast.length > 0 && (
          <section aria-labelledby="explore-cast-heading" className="grid gap-3">
            <h3 id="explore-cast-heading" className="text-[13px] font-bold tracking-[0.1em] text-text-secondary">
              CAST
            </h3>
            <ul className="grid grid-cols-3 gap-3">
              {d.cast.map((person, i) => (
                <li key={`${person.name}-${i}`} className="grid min-w-0 content-start gap-1.5">
                  {person.profileUrl ? (
                    <img src={person.profileUrl} alt="" loading="lazy" className="aspect-[2/3] w-full rounded-xl bg-surface object-cover" />
                  ) : (
                    <div className="aspect-[2/3] w-full rounded-xl bg-surface" aria-hidden="true" />
                  )}
                  <span className="text-[13px] font-semibold leading-tight text-white">{person.name}</span>
                  {person.character && <span className="text-xs leading-tight text-text-tertiary">{person.character}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

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
