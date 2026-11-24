import { WatchedBadge } from "../Poster";
import { Star } from "../explore/ExploreRow";
import { smallBackdrop } from "../../lib/feed";
import { useOpinion } from "../../lib/opinions";
import type { ExploreItem } from "../../lib/explore";

const kindOf = (item: ExploreItem) => (item.tmdbType === "tv" ? "Series" : "Film");

function Badges({ item }: { item: ExploreItem }) {
  const watched = useOpinion({ type: item.tmdbType, id: item.tmdbId })?.watched;
  return (
    <div className="absolute inset-x-2 top-2 flex items-start gap-2">
      {item.inLibrary && (
        <span className="rounded-md bg-live px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-background">IN LIBRARY</span>
      )}
      {watched && <WatchedBadge />}
    </div>
  );
}

/** The facts that come up over the artwork under the pointer. */
function HoverFacts({ item }: { item: ExploreItem }) {
  return (
    <div className="absolute inset-x-0 bottom-0 translate-y-2 bg-gradient-to-t from-black/95 via-black/70 to-transparent px-3 pb-3 pt-10 text-left opacity-0 transition duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
      <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-white">
        {item.rating !== null && (
          <span className="inline-flex items-center gap-1 font-semibold">
            <Star className="h-3 w-3 text-amber" />
            {item.rating.toFixed(1)}
          </span>
        )}
        <span className="text-text-secondary">{item.genres.slice(0, 2).join(" · ")}</span>
      </p>
    </div>
  );
}

const FRAME =
  "relative overflow-hidden rounded-xl bg-surface ring-1 ring-divider transition duration-200 group-hover:ring-2 group-hover:ring-white/70 group-focus-visible:ring-2 group-focus-visible:ring-accent motion-safe:group-hover:scale-[1.03]";

type CardProps = { item: ExploreItem; onOpen: (item: ExploreItem) => void };

const label = (item: ExploreItem, rank?: number) =>
  `${rank ? `Number ${rank}: ` : ""}${item.title}${item.year ? ` (${item.year})` : ""}, ${kindOf(item)}${item.inLibrary ? ", in your library" : ""}`;

/** A poster, its title and year under it. */
export function PosterTitleCard({ item, onOpen }: CardProps) {
  return (
    <button type="button" onClick={() => onOpen(item)} aria-label={label(item)} className="group block w-full text-left outline-none">
      <div className={`aspect-[2/3] ${FRAME}`}>
        {item.posterUrl && <img src={item.posterUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />}
        <Badges item={item} />
        <HoverFacts item={item} />
      </div>
      <p className="mt-2 truncate text-sm font-semibold text-white">{item.title}</p>
      <p className="text-xs text-text-tertiary">{[item.year, kindOf(item)].filter(Boolean).join(" · ")}</p>
    </button>
  );
}

/** A still, with the title on it. */
export function WideTitleCard({ item, onOpen }: CardProps) {
  const image = smallBackdrop(item.backdropUrl) ?? item.posterUrl;
  return (
    <button type="button" onClick={() => onOpen(item)} aria-label={label(item)} className="group block w-full text-left outline-none">
      <div className={`aspect-video ${FRAME}`}>
        {image && <img src={image} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/15 to-transparent" />
        <Badges item={item} />
        <div className="absolute inset-x-3.5 bottom-3">
          <p className="truncate font-display text-2xl leading-none tracking-wide text-white">{item.title}</p>
          <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-text-secondary">
            {item.rating !== null && (
              <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-white">
                <Star className="h-3 w-3 text-amber" />
                {item.rating.toFixed(1)}
              </span>
            )}
            <span className="truncate">{[item.year, kindOf(item), item.genres[0]].filter(Boolean).join(" · ")}</span>
          </p>
        </div>
      </div>
    </button>
  );
}

/** A poster beside its place in the list. */
export function RankTitleCard({ item, rank, onOpen }: CardProps & { rank: number }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      aria-label={label(item, rank)}
      className="group relative block w-full pl-[38%] text-left outline-none"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[-0.06em] left-0 select-none font-display text-[9.5rem] leading-[0.8] tracking-[-0.06em] text-background sm:text-[12rem]"
        style={{ WebkitTextStroke: "3px #6f665c" }}
      >
        {rank}
      </span>
      <div className={`aspect-[2/3] ${FRAME}`}>
        {item.posterUrl && <img src={item.posterUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />}
        <Badges item={item} />
        <HoverFacts item={item} />
      </div>
    </button>
  );
}
