import { tmdbCached } from "./explore";

/** A title's official trailer, from TMDb's own video list. */
export type Trailer = { name: string; youtubeId: string };

type TmdbVideo = {
  key?: string;
  name?: string;
  site?: string;
  type?: string;
  official?: boolean;
  iso_639_1?: string;
  published_at?: string;
};

const TTL_MS = 12 * 60 * 60_000;

/** Official before not, a trailer before a teaser, English before other languages, newest first. */
export function pickTrailer(videos: TmdbVideo[]): Trailer | null {
  const rank = (v: TmdbVideo) =>
    (v.official ? 0 : 4) + (v.type === "Trailer" ? 0 : 2) + (v.iso_639_1 === "en" ? 0 : 1);
  const best = videos
    .filter((v) => v.site === "YouTube" && /^[\w-]{11}$/.test(v.key ?? "") && (v.type === "Trailer" || v.type === "Teaser"))
    .sort((a, b) => rank(a) - rank(b) || (b.published_at ?? "").localeCompare(a.published_at ?? ""))[0];
  return best ? { name: best.name?.trim() || "Trailer", youtubeId: best.key! } : null;
}

export async function trailerFor(type: "movie" | "tv", tmdbId: string): Promise<Trailer | null> {
  const found = await tmdbCached<{ results?: TmdbVideo[] }>(
    `/${type}/${tmdbId}/videos`,
    // Without this TMDb returns only English videos, and many Indian films have none.
    { include_video_language: "en,hi,ta,te,ml,kn,bn,mr,pa,null" },
    TTL_MS,
  );
  return pickTrailer(found?.results ?? []);
}
