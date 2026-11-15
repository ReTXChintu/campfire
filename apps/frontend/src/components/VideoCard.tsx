import { Link } from "react-router-dom";
import type { CatalogVideoListItem } from "../lib/catalogListItem";
import type { WatchProgress } from "../lib/types";
import Poster, { PosterAction, PosterBadge, PosterProgress } from "./Poster";
import { formatLabel, playsInBrowser, remainingLabel } from "../lib/mediaFormat";
import { progressPercent } from "../lib/progress";

/**
 * One film or episode. Everything it shows comes from the API: the Drive thumbnail, the name, the
 * container (from `mimeType`) and — when there's a progress record — how much is left. There is no
 * year, runtime, resolution or genre on a catalog list item, so the card doesn't pretend otherwise.
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
  const browserPlayable = playsInBrowser(item.mimeType);

  return (
    <Link to={`/watch/${item.id}`} className="group block rounded-xl">
      <Poster path={`/api/thumbnail/${item.id}`} title={item.name} id={item.id} ratio={ratio}>
        <div className="absolute inset-x-1.5 top-1.5 flex items-start justify-between gap-2">
          <PosterBadge tone={browserPlayable ? "neutral" : "warn"}>{formatLabel(item.mimeType)}</PosterBadge>
          {progress?.completed && (
            <span className="grid h-5 w-5 place-items-center rounded-full bg-live" title="Watched">
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="black" strokeWidth={3} aria-hidden="true">
                <polyline points="4 12 9 17 20 6" />
              </svg>
            </span>
          )}
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
        <span>{browserPlayable ? formatLabel(item.mimeType) : "Needs the app"}</span>
      </p>
    </Link>
  );
}
