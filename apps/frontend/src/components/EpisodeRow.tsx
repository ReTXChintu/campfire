import { Link } from "react-router-dom";
import type { CatalogVideoListItem } from "../lib/catalogListItem";
import type { WatchProgress } from "../lib/types";
import Poster, { PosterProgress } from "./Poster";
import { formatLabel, playsInBrowser, remainingLabel } from "../lib/mediaFormat";

/** One row of a season's episode list: the still, the position in the season, the name, and the
 * real watch state. Used by the series and folder detail pages (the prototype's episode list). */
export default function EpisodeRow({
  item,
  index,
  progress,
}: {
  item: CatalogVideoListItem;
  index: number;
  progress?: WatchProgress;
}) {
  const percent =
    progress && progress.durationSeconds > 0
      ? Math.min(100, (progress.positionSeconds / progress.durationSeconds) * 100)
      : 0;
  const remaining = progress
    ? remainingLabel(progress.positionSeconds, progress.durationSeconds, progress.completed)
    : null;
  const browserPlayable = playsInBrowser(item.mimeType);

  return (
    <Link
      to={`/watch/${item.id}`}
      className="group grid grid-cols-[92px_minmax(0,1fr)] items-center gap-3 rounded-xl border border-transparent p-2 transition hover:border-divider hover:bg-surface sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-4"
    >
      <Poster path={`/api/thumbnail/${item.id}`} title={item.name} id={item.id} ratio="still">
        {percent > 0 && <PosterProgress percent={percent} />}
      </Poster>
      <div className="min-w-0">
        <p className="font-mono text-[11px] text-text-tertiary">{String(index + 1).padStart(2, "0")}</p>
        <h3 className="truncate text-sm font-semibold text-white transition group-hover:text-amber">{item.name}</h3>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-text-tertiary">
          {remaining && <span className={progress?.completed ? "text-live" : "text-text-secondary"}>{remaining}</span>}
          {remaining && <span aria-hidden="true">·</span>}
          <span>{browserPlayable ? formatLabel(item.mimeType) : "Needs the app"}</span>
        </p>
      </div>
    </Link>
  );
}
