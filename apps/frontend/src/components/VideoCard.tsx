import { Link } from "react-router-dom";
import type { CatalogVideoListItem } from "../lib/catalogListItem";
import type { WatchProgress } from "../lib/types";
import Poster, { PosterAction, PosterBadge, PosterProgress, WatchedBadge } from "./Poster";
import { useOpinion } from "../lib/opinions";
import { formatLabel, playsInBrowser, remainingLabel } from "../lib/mediaFormat";
import { progressPercent } from "../lib/progress";
import { RatingChip } from "./MetaLine";

/**
 * One film or episode. Everything it shows comes from the API: the artwork, the name, the container
 * (from `mimeType`), how much is left when there's a progress record, and — for a title matched on
 * TMDb — its year and score. Nothing is invented: an unmatched title simply shows fewer facts.
 */
export default function VideoCard({
  item,
  progress,
  ratio = "poster",
}: {
  item: CatalogVideoListItem;
  progress?: WatchProgress;
  /** Continue-watching uses the wide still; rails and grids use the poster frame. */
  ratio?: "poster" | "still";
}) {
  const percent = progressPercent(progress);
  const remaining = progress
    ? remainingLabel(progress.positionSeconds, progress.durationSeconds, progress.completed)
    : null;
  // What the viewer said about the film, else whether it was played to the end.
  const opinion = useOpinion(item.tmdb);
  const watched = opinion?.watched ?? progress?.completed;
  const browserPlayable = playsInBrowser(item.mimeType);

  return (
    <Link to={`/watch/${item.id}`} className="group block rounded-xl">
      <Poster path={`/api/thumbnail/${item.id}`} title={item.name} id={item.id} ratio={ratio}>
        <div className="absolute inset-x-1.5 top-1.5 flex items-start justify-between gap-2">
          <PosterBadge tone={browserPlayable ? "neutral" : "warn"}>{formatLabel(item.mimeType)}</PosterBadge>
          {watched && <WatchedBadge />}
        </div>
        <PosterAction label={percent > 0 && !progress?.completed ? "Resume" : "Play"} />
        {percent > 0 && <PosterProgress percent={percent} done={!!progress?.completed} />}
      </Poster>

      <h3 className="mt-2.5 line-clamp-2 text-sm font-semibold text-white transition group-hover:text-amber">
        {item.name}
      </h3>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-text-tertiary">
        {remaining && <span className="text-text-secondary">{remaining}</span>}
        {remaining && <span aria-hidden="true">·</span>}
        <RatingChip rating={item.rating} className="text-xs" />
        {item.rating && <span aria-hidden="true">·</span>}
        {item.year && (
          <>
            <span>{item.year}</span>
            <span aria-hidden="true">·</span>
          </>
        )}
        <span>{browserPlayable ? formatLabel(item.mimeType) : "Needs the app"}</span>
      </p>
    </Link>
  );
}
