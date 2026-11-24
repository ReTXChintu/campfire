import type { ArtworkFields } from "./artwork";
import { getDb } from "./mongodb";
import { libraryMatches } from "./tmdbSearch";

/** Which TMDb title — or which episode of one — a catalog item is. This, not the Drive file id, is
 * a title's identity: a replaced or duplicated file is still the same title, so anything that
 * belongs to the title (its embeds, its trailer) is stored and looked up by it. */
export type TmdbRef = { type: "movie" | "tv"; id: string; season?: number; episode?: number };

/** Null for something TMDb doesn't have (a home video) or that hasn't been matched yet. */
export function tmdbRefOf(doc: Pick<ArtworkFields, "artwork" | "episodeArtwork">): TmdbRef | null {
  if (doc.artwork) return { type: doc.artwork.tmdbType, id: doc.artwork.tmdbId };
  const e = doc.episodeArtwork;
  return e ? { type: "tv", id: e.seriesTmdbId, season: e.season, episode: e.episode } : null;
}

/** "movie:603", "tv:1396:s1e2". */
export function tmdbKey(ref: TmdbRef): string {
  const episode = ref.season != null && ref.episode != null ? `:s${ref.season}e${ref.episode}` : "";
  return `${ref.type}:${ref.id}${episode}`;
}

/** The id a title is watched by when the library doesn't have it: "tmdb:movie:603",
 * "tmdb:tv:1396:s1e2". A Drive file's id has no colon in it. */
export const titleId = (ref: TmdbRef) => `tmdb:${tmdbKey(ref)}`;

/** Null for a Drive file's id. A series as a whole isn't watched, so it has none. */
export function parseTitleId(id: string): TmdbRef | null {
  const film = id.match(/^tmdb:movie:([1-9]\d{0,9})$/);
  if (film) return { type: "movie", id: film[1] };
  const episode = id.match(/^tmdb:tv:([1-9]\d{0,9}):s(\d{1,3})e(\d{1,4})$/);
  return episode ? { type: "tv", id: episode[1], season: Number(episode[2]), episode: Number(episode[3]) } : null;
}

/** The published library item that is this title, or null when the library doesn't have it. */
export async function findByTmdb(ref: TmdbRef): Promise<{ kind: "folder" | "video"; id: string } | null> {
  if (ref.season != null && ref.episode != null) {
    const db = await getDb();
    const video = await db.collection<{ _id: string }>("catalogVideos").findOne(
      {
        status: "published",
        "episodeArtwork.seriesTmdbId": ref.id,
        "episodeArtwork.season": ref.season,
        "episodeArtwork.episode": ref.episode,
      },
      { projection: { _id: 1 } },
    );
    return video ? { kind: "video", id: video._id } : null;
  }
  const found = await libraryMatches([{ tmdbType: ref.type, tmdbId: ref.id }]);
  return found.get(`${ref.type}:${ref.id}`) ?? null;
}
