import { env } from "../config/env";
import type { ReferenceMeta, MediaRequestType } from "./mediaRequests";

/** A request's reference is either an IMDb/TMDb link or an uploaded image — never free-form notes,
 * a year or a season list (the form is deliberately two fields). This module is the link half:
 * it recognises the link, and — only when TMDB_API_KEY is configured — turns it into real
 * metadata so the request board and the admin panel can show a poster and a year instead of a
 * bare URL. Everything here degrades to "link stored, not enriched" without the key; nothing
 * depends on the lookup succeeding. */

export type ParsedReference =
  | { source: "imdb"; id: string }
  | { source: "tmdb"; id: string; type: MediaRequestType };

/** Accepts the forms people actually paste: a full imdb.com/title/tt… URL (with or without the
 * www/locale prefix, query string or trailing slash), a bare `tt…` id, or a themoviedb.org
 * movie/tv URL. */
export function parseReferenceLink(raw: string): ParsedReference | null {
  const value = raw.trim();
  if (!value) return null;

  const bareImdb = value.match(/^(tt\d{6,})$/i);
  if (bareImdb) return { source: "imdb", id: bareImdb[1].toLowerCase() };

  let url: URL;
  try {
    url = new URL(value.includes("://") ? value : `https://${value}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./i, "").toLowerCase();

  if (host === "imdb.com" || host.endsWith(".imdb.com")) {
    const match = url.pathname.match(/\/title\/(tt\d{6,})/i);
    return match ? { source: "imdb", id: match[1].toLowerCase() } : null;
  }

  if (host === "themoviedb.org" || host.endsWith(".themoviedb.org")) {
    const match = url.pathname.match(/\/(movie|tv)\/(\d+)/i);
    if (!match) return null;
    return { source: "tmdb", id: match[2], type: match[1].toLowerCase() === "tv" ? "series" : "movie" };
  }

  return null;
}

export function isSupportedReferenceLink(raw: string): boolean {
  return parseReferenceLink(raw) !== null;
}

const POSTER_BASE = "https://image.tmdb.org/t/p/w342";
const LOOKUP_TIMEOUT_MS = 6000;

export async function tmdbFetch<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const key = env.tmdbApiKey;
  if (!key) return null;

  const url = new URL(`${env.tmdbApiBase}${path}`);
  url.searchParams.set("api_key", key);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);

  // A metadata lookup must never hold up (or fail) a request submission — every caller treats
  // null as "no metadata", so a timeout, an outage or a bad key is a cosmetic loss, not an error.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type TmdbTitle = {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  overview?: string | null;
};

function toMeta(raw: TmdbTitle, type: MediaRequestType | null): ReferenceMeta {
  const date = raw.release_date || raw.first_air_date || "";
  const year = /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null;
  return {
    source: "tmdb",
    sourceId: String(raw.id),
    title: raw.title || raw.name || "",
    year,
    type,
    posterUrl: raw.poster_path ? `${POSTER_BASE}${raw.poster_path}` : null,
    overview: raw.overview?.trim() || null,
  };
}

/** Resolves a parsed link to metadata, or null when enrichment is unavailable (no API key, no
 * network, unknown id). IMDb has no free public API, so an IMDb id is resolved through TMDb's
 * `/find` endpoint, which indexes them. */
export async function lookupReference(parsed: ParsedReference): Promise<ReferenceMeta | null> {
  if (!env.tmdbApiKey) return null;

  if (parsed.source === "tmdb") {
    const path = parsed.type === "series" ? `/tv/${parsed.id}` : `/movie/${parsed.id}`;
    const raw = await tmdbFetch<TmdbTitle>(path, {});
    return raw ? toMeta(raw, parsed.type) : null;
  }

  const found = await tmdbFetch<{ movie_results: TmdbTitle[]; tv_results: TmdbTitle[] }>(
    `/find/${parsed.id}`,
    { external_source: "imdb_id" },
  );
  if (!found) return null;
  const movie = found.movie_results?.[0];
  if (movie) return toMeta(movie, "movie");
  const tv = found.tv_results?.[0];
  if (tv) return toMeta(tv, "series");
  return null;
}

/** Convenience for the routes: parse + look up in one call. Returns the parse result separately
 * so a caller can tell "not a supported link" (reject) from "supported but not enriched" (fine). */
export async function resolveReferenceLink(
  raw: string,
): Promise<{ parsed: ParsedReference; meta: ReferenceMeta | null } | null> {
  const parsed = parseReferenceLink(raw);
  if (!parsed) return null;
  return { parsed, meta: await lookupReference(parsed) };
}
