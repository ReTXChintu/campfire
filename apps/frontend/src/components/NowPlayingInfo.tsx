import { Link } from "react-router-dom";
import MetaLine, { RatingChip } from "./MetaLine";
import CastRow from "./CastRow";
import type { VideoResponse } from "../lib/types";
import { airDateLabel, episodeLabel, runtimeLabel } from "../lib/tmdbFormat";

/**
 * What's playing, under the player: which episode this is and what happens in it, or — for a film
 * — its facts, synopsis and cast.
 *
 * Renders nothing at all when the title isn't matched on TMDb, because the player already shows
 * the name and a box repeating it would be worse than no box.
 */
export default function NowPlayingInfo({ video }: { video: VideoResponse }) {
  const episode = video.episode;
  const hasTitleMeta = !!(video.overview || video.tagline || video.rating || video.genres?.length || video.certificate);
  if (!episode && !hasTitleMeta) return null;

  if (episode) {
    const label = episodeLabel(episode.season, episode.number);
    const runtime = runtimeLabel(episode.runtimeMinutes);
    const aired = airDateLabel(episode.airDate);
    return (
      <section className="mt-6 rounded-2xl border border-divider bg-surface p-4" aria-labelledby="now-playing-heading">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-text-secondary">
          {label && <span className="font-mono text-xs tracking-wide text-amber">{label}</span>}
          <RatingChip rating={episode.rating} />
          {runtime && <span>{runtime}</span>}
          {aired && <span>{aired}</span>}
        </div>
        <h2 id="now-playing-heading" className="mt-1 text-xl font-semibold text-white">
          {video.title}
        </h2>
        {episode.overview && (
          <p className="mt-2 max-w-[80ch] text-sm leading-relaxed text-text-secondary">{episode.overview}</p>
        )}
        <Link
          to={video.backHref}
          className="mt-3 inline-flex text-sm text-text-tertiary underline-offset-2 transition hover:text-white hover:underline"
        >
          All episodes
        </Link>
      </section>
    );
  }

  return (
    <section className="mt-6 rounded-2xl border border-divider bg-surface p-4" aria-labelledby="now-playing-heading">
      <h2 id="now-playing-heading" className="text-xl font-semibold text-white">
        {video.title}
      </h2>
      <MetaLine meta={video} className="mt-1.5" />
      {video.tagline && <p className="mt-2 text-sm italic text-text-tertiary">{video.tagline}</p>}
      {video.overview && (
        <p className="mt-2 max-w-[80ch] text-sm leading-relaxed text-text-secondary">{video.overview}</p>
      )}
      <CastRow cast={video.cast} variant="inline" />
    </section>
  );
}
