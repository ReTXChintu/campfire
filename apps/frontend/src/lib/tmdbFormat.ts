import type { TmdbRating } from "./types";

/** A runtime in minutes as people say it: "2h 8m", "47m". Null for anything missing or nonsense,
 * so a caller can simply drop the fact. */
export function runtimeLabel(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** TMDb's score to one decimal place. Deliberately not "/10" — the star says what it is. */
export function ratingLabel(rating: TmdbRating | null | undefined): string | null {
  if (!rating || rating.average <= 0) return null;
  return rating.average.toFixed(1);
}

/** A vote count for a tooltip: "1,200 votes on TMDb". */
export function ratingTitle(rating: TmdbRating | null | undefined): string | undefined {
  if (!rating) return undefined;
  return `${rating.average.toFixed(1)} out of 10 from ${rating.count.toLocaleString()} ${
    rating.count === 1 ? "vote" : "votes"
  } on TMDb`;
}

/** An air date as "4 Sept 2022", or null when there isn't a usable one. */
export function airDateLabel(airDate: string | null | undefined): string | null {
  if (!airDate) return null;
  const parsed = new Date(airDate);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** "S1 E4", or "E4" when the season isn't known. Null when there's no number to show. */
export function episodeLabel(season: number | null | undefined, number: number | null | undefined): string | null {
  if (number == null) return null;
  return season != null && season > 0 ? `S${season} E${number}` : `E${number}`;
}
