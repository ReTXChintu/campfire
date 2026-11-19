import { env } from "../config/env";
import { getDb } from "./mongodb";
import { findOpenRequestsByTmdbIds, type MediaRequest, type MediaRequestStatus } from "./mediaRequests";
import { parseReferenceLink, tmdbFetch } from "./referenceLink";

/** The request form's title search: the requester types a name, picks the right TMDb result, and
 * the request goes in with that title and its exact TMDb link — so the admin gets precisely the
 * title that was meant instead of a guess from a half-remembered name or a mis-pasted URL.
 * Each result also says whether it's already in the library or already asked for, because those
 * are the two answers that should stop a new request before it's made.
 *
 * It's a picker for the existing reference, not a new kind of request: what gets submitted is
 * still a title plus one link, validated and resolved by the same create route as a pasted one. */

export type TmdbSearchResult = {
  tmdbType: "movie" | "tv";
  tmdbId: string;
  title: string;
  year: number | null;
  overview: string | null;
  posterUrl: string | null;
  link: string;
  inLibrary: { kind: "folder" | "video"; id: string } | null;
  existingRequest: { id: string; wantCount: number; status: MediaRequestStatus; iWantIt: boolean } | null;
};

export const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;
const MAX_RESULTS = 10;
// A result row is a thumbnail, so the small size; the request's own card (resolved from the link
// on submit, see referenceLink.ts) still gets the larger poster.
const SEARCH_POSTER_BASE = "https://image.tmdb.org/t/p/w185";
// Enough to tell two same-named titles apart; the full synopsis is a tap away on TMDb.
const OVERVIEW_MAX = 180;

type TmdbMultiResult = {
  id: number;
  media_type?: string;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  overview?: string | null;
};

export function isTmdbSearchAvailable(): boolean {
  return Boolean(env.tmdbApiKey);
}

function shortOverview(raw: string | null | undefined): string | null {
  const text = raw?.trim().replace(/\s+/g, " ");
  if (!text) return null;
  if (text.length <= OVERVIEW_MAX) return text;
  const cut = text.slice(0, OVERVIEW_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > OVERVIEW_MAX / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

const keyOf = (tmdbType: "movie" | "tv", tmdbId: string) => `${tmdbType}:${tmdbId}`;

/** Published catalog items matched to any of these titles. Only published ones: "Already in
 * Campfire" has to be something the requester can actually open. */
async function libraryMatches(keys: { tmdbType: "movie" | "tv"; tmdbId: string }[]) {
  const ids = [...new Set(keys.map((k) => k.tmdbId))];
  const found = new Map<string, { kind: "folder" | "video"; id: string }>();
  if (!ids.length) return found;
  const db = await getDb();
  const query = { status: "published", "artwork.tmdbId": { $in: ids } };
  const projection = { _id: 1, "artwork.tmdbType": 1, "artwork.tmdbId": 1 };
  type Row = { _id: string; artwork: { tmdbType: "movie" | "tv"; tmdbId: string } };
  const [folders, videos] = await Promise.all([
    db.collection<Row>("catalogFolders").find(query, { projection }).toArray(),
    db.collection<Row>("catalogVideos").find(query, { projection }).toArray(),
  ]);
  // A series is normally a folder and a film normally a single video, so when one title is in the
  // library both ways (a film inside its own folder of extras, say) that's the one to link to.
  const add = (rows: Row[], kind: "folder" | "video", preferredFor: "movie" | "tv") => {
    for (const row of rows) {
      const key = keyOf(row.artwork.tmdbType, row.artwork.tmdbId);
      if (!found.has(key) || row.artwork.tmdbType === preferredFor) found.set(key, { kind, id: row._id });
    }
  };
  add(videos, "video", "movie");
  add(folders, "folder", "tv");
  return found;
}

/** Which TMDb title an open request names, as a search-result key — or null for an image-only
 * request, or a link the lookup never resolved to a TMDb title (an IMDb link with no key). */
function requestKey(doc: MediaRequest): string | null {
  if (doc.refMeta?.source === "tmdb" && doc.refMeta.type) {
    return keyOf(doc.refMeta.type === "series" ? "tv" : "movie", doc.refMeta.sourceId);
  }
  const parsed = doc.refLink ? parseReferenceLink(doc.refLink) : null;
  if (parsed?.source === "tmdb") return keyOf(parsed.type === "series" ? "tv" : "movie", parsed.id);
  return null;
}

async function requestMatches(ids: string[], viewerId: string) {
  const found = new Map<string, NonNullable<TmdbSearchResult["existingRequest"]>>();
  for (const doc of await findOpenRequestsByTmdbIds(ids)) {
    const key = requestKey(doc);
    if (!key) continue;
    // More than one open request for the same title can exist (two people asked before search
    // did the dedupe); the vote goes to whichever already has the most.
    const current = found.get(key);
    if (current && current.wantCount >= doc.upvotes.length) continue;
    found.set(key, {
      id: doc._id,
      wantCount: doc.upvotes.length,
      status: doc.status,
      iWantIt: doc.upvotes.includes(viewerId),
    });
  }
  return found;
}

/** Null when TMDb couldn't be reached (or refused the key) — distinct from an empty list, which
 * means it answered and found nothing. */
export async function searchTmdbTitles(rawQuery: string, viewerId: string): Promise<TmdbSearchResult[] | null> {
  const query = rawQuery.trim().slice(0, MAX_QUERY_LENGTH);
  if (query.length < MIN_QUERY_LENGTH) return [];

  const found = await tmdbFetch<{ results?: TmdbMultiResult[] }>("/search/multi", {
    query,
    include_adult: "false",
    page: "1",
  });
  if (!found) return null;

  // `/search/multi` also returns people (and the odd collection); only films and series can be
  // requested.
  const titles = (found.results ?? [])
    .filter((r): r is TmdbMultiResult & { media_type: "movie" | "tv" } => r.media_type === "movie" || r.media_type === "tv")
    .slice(0, MAX_RESULTS)
    .map((r) => {
      const date = r.release_date || r.first_air_date || "";
      return {
        tmdbType: r.media_type,
        tmdbId: String(r.id),
        title: (r.title || r.name || "").trim(),
        year: /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null,
        overview: shortOverview(r.overview),
        posterUrl: r.poster_path ? `${SEARCH_POSTER_BASE}${r.poster_path}` : null,
        link: `https://www.themoviedb.org/${r.media_type}/${r.id}`,
      };
    })
    .filter((r) => r.title);

  const [inLibrary, existing] = await Promise.all([
    libraryMatches(titles),
    requestMatches(
      titles.map((t) => t.tmdbId),
      viewerId,
    ),
  ]);

  return titles.map((t) => {
    const key = keyOf(t.tmdbType, t.tmdbId);
    return { ...t, inLibrary: inLibrary.get(key) ?? null, existingRequest: existing.get(key) ?? null };
  });
}
