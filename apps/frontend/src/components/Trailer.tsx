import { useState } from "react";
import { trailerSrc, useTrailer } from "../lib/trailer";
import type { TmdbRef } from "../lib/types";

/** The title's official trailer, looked up by TMDb id. Renders nothing when there isn't one. The
 * still loads by itself; YouTube's player only once it's pressed, so it never talks over the film. */
export default function Trailer({ tmdb, className }: { tmdb: TmdbRef | null | undefined; className?: string }) {
  const [playing, setPlaying] = useState<string | null>(null);
  const { data: trailer } = useTrailer(tmdb);
  if (!trailer) return null;

  return (
    <section aria-label="Trailer" className={className}>
      <h2 className="mb-3 font-display text-2xl tracking-wide text-white">Trailer</h2>
      <div className="aspect-video w-full max-w-full overflow-hidden rounded-xl border border-divider bg-black sm:w-[480px]">
        {playing === trailer.youtubeId ? (
          <iframe
            src={trailerSrc(trailer)}
            title={trailer.name}
            className="h-full w-full border-0"
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation"
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(trailer.youtubeId)}
            aria-label={`Play ${trailer.name}`}
            className="group relative block h-full w-full"
          >
            <img
              src={`https://i.ytimg.com/vi/${trailer.youtubeId}/hqdefault.jpg`}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover opacity-80 transition group-hover:opacity-100"
            />
            <span className="absolute inset-0 grid place-items-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-accent text-black shadow-lg">
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden="true">
                  <polygon points="8,5 19,12 8,19" />
                </svg>
              </span>
            </span>
            <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-6 text-left text-sm text-white">
              {trailer.name}
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
