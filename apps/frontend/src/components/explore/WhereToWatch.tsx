import { Link } from "react-router-dom";
import type { ExploreDetail as Detail, ExploreOffer } from "../../lib/explore";
import { useCreateRequest, useToggleUpvote } from "../../hooks/useRequests";

const HEADING = "font-display text-2xl tracking-wide text-white";

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

/** Where a title streams in India, and a way to ask for it when the library doesn't have it. */
export default function WhereToWatch({ d }: { d: Detail }) {
  const nowhere = !d.watch.stream.length && !d.watch.free.length && !d.watch.rentBuy.length;
  return (
    <section aria-labelledby="explore-watch-heading" className="grid content-start gap-3">
      <h3 id="explore-watch-heading" className={HEADING}>
        Where to watch in India
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
      {!d.inLibrary && <RequestBlock d={d} />}
    </section>
  );
}
