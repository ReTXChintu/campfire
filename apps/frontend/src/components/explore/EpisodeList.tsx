import { useState } from "react";
import { Link } from "react-router-dom";
import { playHref, useSeriesEpisodes, type SeriesEpisode } from "../../lib/play";
import { progressPercent } from "../../lib/progress";
import { airDateLabel, runtimeLabel } from "../../lib/tmdbFormat";
import { Skeleton } from "../ui/States";

/** How many episodes show before "Show all". */
const FIRST = 10;

function Row({ seriesId, season, episode }: { seriesId: string; season: number; episode: SeriesEpisode }) {
  const percent = progressPercent(episode.progress ?? undefined);
  const facts = [runtimeLabel(episode.runtimeMinutes), airDateLabel(episode.airDate)].filter(Boolean).join(" · ");
  const body = (
    <>
      <span className="w-6 shrink-0 text-center font-display text-2xl text-text-tertiary" aria-hidden="true">
        {episode.number}
      </span>
      <span className="relative block aspect-video w-32 shrink-0 overflow-hidden rounded-lg bg-surface sm:w-44">
        {episode.stillUrl && <img src={episode.stillUrl} alt="" loading="lazy" className="h-full w-full object-cover" />}
        {episode.aired && (
          <span className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-white text-black">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
                <polygon points="8,5 19,12 8,19" />
              </svg>
            </span>
          </span>
        )}
        {percent > 0 && (
          <span className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
            <span
              className={`block h-full ${episode.progress?.completed ? "bg-live" : "bg-accent"}`}
              style={{ width: `${percent}%` }}
            />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-white">{episode.name}</span>
        <span className="mt-0.5 block text-xs text-text-tertiary">
          {[episode.progress?.completed ? "Watched" : null, episode.aired ? null : "Not out yet", facts].filter(Boolean).join(" · ")}
        </span>
        {episode.overview && (
          <span className="mt-1.5 hidden max-w-[80ch] text-sm leading-relaxed text-text-secondary sm:line-clamp-2">{episode.overview}</span>
        )}
      </span>
    </>
  );
  const layout = "flex items-center gap-3 rounded-xl p-2.5 text-left sm:gap-4";
  return (
    <li>
      {episode.aired ? (
        <Link
          to={playHref({ type: "tv", id: seriesId, season, episode: episode.number })}
          aria-label={`Play episode ${episode.number}, ${episode.name}`}
          className={`group ${layout} transition hover:bg-surface`}
        >
          {body}
        </Link>
      ) : (
        <div className={`${layout} opacity-50`}>{body}</div>
      )}
    </li>
  );
}

/** A series' episodes, a season at a time, opened on the one the viewer is in. */
export default function EpisodeList({ seriesId, headingClass }: { seriesId: string; headingClass: string }) {
  const [season, setSeason] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const { data, isLoading, isPlaceholderData } = useSeriesEpisodes(seriesId, season);
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!data) return null;
  // Opened far enough to show the episode they're in.
  const resumeAt = data.resume.season === data.season ? data.episodes.findIndex((e) => e.number === data.resume.episode) : -1;
  const limit = all ? data.episodes.length : Math.max(FIRST, resumeAt + 2);

  return (
    <section aria-labelledby="detail-episodes-heading" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="detail-episodes-heading" className={headingClass}>
          Episodes
        </h3>
        {data.seasons.length > 1 && (
          <select
            aria-label="Season"
            value={data.season}
            onChange={(event) => {
              setSeason(Number(event.target.value));
              setAll(false);
            }}
            className="min-h-11 rounded-lg border border-divider-strong bg-surface px-3 text-sm font-semibold text-white outline-none focus:border-accent"
          >
            {data.seasons.map((s) => (
              <option key={s.number} value={s.number}>
                {s.name} ({s.count})
              </option>
            ))}
          </select>
        )}
      </div>
      <ol className={`divide-y divide-divider ${isPlaceholderData ? "opacity-50" : ""}`}>
        {data.episodes.slice(0, limit).map((episode) => (
          <Row key={`${data.season}-${episode.number}`} seriesId={seriesId} season={data.season} episode={episode} />
        ))}
      </ol>
      {data.episodes.length > limit && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="min-h-11 justify-self-start rounded-lg border border-divider-strong px-5 text-sm font-semibold text-white transition hover:bg-surface-hover"
        >
          Show all {data.episodes.length}
        </button>
      )}
    </section>
  );
}
