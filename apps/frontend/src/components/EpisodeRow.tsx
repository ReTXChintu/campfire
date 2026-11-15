import { Link } from "react-router-dom";
import type { CatalogVideoListItem } from "../lib/catalogListItem";
import type { WatchProgress } from "../lib/types";
import Poster, { PosterProgress } from "./Poster";
import { formatLabel, playsInBrowser, remainingLabel } from "../lib/mediaFormat";
import { progressPercent } from "../lib/progress";
import { runtimeLabel } from "../lib/tmdbFormat";
import { RatingChip } from "./MetaLine";

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
  const percent = progressPercent(progress);
  const remaining = progress
    ? remainingLabel(progress.positionSeconds, progress.durationSeconds, progress.completed)
    : null;
  const browserPlayable = playsInBrowser(item.mimeType);
  // TMDb's own episode number when its series is matched, else the position in the list — which is
  // what this always used to show.
  const number = item.episodeNumber ?? index + 1;
  const runtime = runtimeLabel(item.runtimeMinutes);

  return (
    <Link
      to={`/watch/${item.id}`}
      className="group grid grid-cols-[92px_minmax(0,1fr)] items-center gap-3 rounded-xl border border-transparent p-2 transition hover:border-divider hover:bg-surface sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-4"
    >
      <Poster path={`/api/thumbnail/${item.id}`} title={item.name} id={item.id} ratio="still">
        {percent > 0 && <PosterProgress percent={percent} done={!!progress?.completed} />}
      </Poster>
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-mono text-[11px] text-text-tertiary">
          <span>{String(number).padStart(2, "0")}</span>
          <RatingChip rating={item.rating} className="text-[11px]" />
        </p>
        <h3 className="truncate text-sm font-semibold text-white transition group-hover:text-amber">{item.name}</h3>
        {item.overview && (
          // Two lines: enough to tell episodes apart, not enough to turn the list into a wall.
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-secondary">{item.overview}</p>
        )}
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-text-tertiary">
          {remaining && <span className={progress?.completed ? "text-live" : "text-text-secondary"}>{remaining}</span>}
          {remaining && <span aria-hidden="true">·</span>}
          {runtime && (
            <>
              <span>{runtime}</span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <span>{browserPlayable ? formatLabel(item.mimeType) : "Needs the app"}</span>
        </p>
      </div>
    </Link>
  );
}
