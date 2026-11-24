import type { ArtworkKind, CatalogArtwork, CatalogEpisodeArtwork } from "./artwork";
import { tmdbRefOf, type TmdbRef } from "./tmdbRef";

/** The TMDb facts a viewer-facing page shows, flattened out of the stored artwork so clients
 * never have to know about TMDb ids, image paths or which fields a given match happened to fill.
 * Every field is nullable or empty by default, so a title with no match (or one matched by an
 * older build) renders the same page with fewer facts on it. */
export type TitleMeta = {
  /** The title's identity; null when it isn't matched. */
  tmdb: TmdbRef | null;
  year: number | null;
  overview: string | null;
  tagline: string | null;
  /** A film's length, or a series' typical episode length. */
  runtimeMinutes: number | null;
  genres: string[];
  /** Age rating as its board writes it: "U/A 16+", "PG-13". */
  certificate: string | null;
  /** TMDb's own user score, out of 10. */
  rating: { average: number; count: number } | null;
  /** The title has a wordmark, loadable from its thumbnail path with `?shape=logo`. */
  hasLogo: boolean;
  seasonCount: number | null;
  episodeCount: number | null;
  cast: { name: string; character: string | null; imagePath: string | null }[];
};

export const emptyTitleMeta: TitleMeta = {
  tmdb: null,
  year: null,
  overview: null,
  tagline: null,
  runtimeMinutes: null,
  genres: [],
  certificate: null,
  rating: null,
  hasLogo: false,
  seasonCount: null,
  episodeCount: null,
  cast: [],
};

/** `kind`/`id` are only needed to build the cast headshot paths — those are served by index into
 * this title's own stored cast list (see routes/thumbnail.ts). */
export function titleMeta(
  artwork: CatalogArtwork | null | undefined,
  kind: ArtworkKind,
  id: string,
): TitleMeta {
  if (!artwork) return emptyTitleMeta;
  return {
    tmdb: tmdbRefOf({ artwork }),
    year: artwork.year ?? null,
    overview: artwork.overview ?? null,
    tagline: artwork.tagline ?? null,
    runtimeMinutes: artwork.runtimeMinutes ?? null,
    genres: artwork.genres ?? [],
    certificate: artwork.certificate ?? null,
    rating: artwork.rating ?? null,
    hasLogo: !!artwork.logoPath,
    seasonCount: artwork.seasonCount ?? null,
    episodeCount: artwork.episodeCount ?? null,
    cast: (artwork.cast ?? []).map((member, index) => ({
      name: member.name,
      character: member.character,
      imagePath: member.profilePath ? `/api/cast-image/${kind}/${id}/${index}` : null,
    })),
  };
}

/** What an episode row and the player header show about one episode. `number` is the episode's
 * own number on TMDb, which is what "E4" should say — not its position in this folder. */
export type EpisodeMeta = {
  number: number | null;
  season: number | null;
  overview: string | null;
  airDate: string | null;
  runtimeMinutes: number | null;
  rating: { average: number; count: number } | null;
};

export function episodeMeta(episode: CatalogEpisodeArtwork | null | undefined): EpisodeMeta | null {
  if (!episode) return null;
  return {
    // A special's number is its place in TMDb's running list of every special the show ever had
    // (India's Got Latent's season-2 bonuses are specials 11–16), which means nothing on screen —
    // so it's left out, and the row falls back to the episode's own order (bonus 1, 2, 3…).
    number: episode.season === 0 ? null : episode.episode || null,
    season: episode.season,
    overview: episode.overview,
    airDate: episode.airDate,
    runtimeMinutes: episode.runtimeMinutes,
    rating: episode.rating,
  };
}
