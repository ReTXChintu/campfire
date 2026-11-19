import type { CatalogListItem } from "./catalogListItem";

// One place for how the library is searched, grouped and sorted, so search, the browse grid and
// Home's genre rows can never disagree about what matches. Everything runs on the client over the
// library listing: there is no search endpoint, and a personal library is small enough not to
// need one.

/** Why an item matched a search — shown under the result, because "Matt Smith" finding House of
 * the Dragon looks like a bug unless it says so. */
export type MatchReason = { kind: "title" } | { kind: "genre"; value: string } | { kind: "cast"; value: string };

const fold = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * Whether an item matches what was typed, and on what. Every word has to appear somewhere — in the
 * title, a genre or an actor's name — so "smith dragon" finds House of the Dragon through two
 * different fields. The title wins when it matches at all, then a genre, then a person.
 */
export function matchItem(item: CatalogListItem, query: string): MatchReason | null {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return { kind: "title" };

  const title = fold(item.name);
  const genres = item.genres ?? [];
  const cast = item.castNames ?? [];
  const haystack = [title, ...genres.map(fold), ...cast.map(fold)].join(" \u0000 ");
  if (!words.every((word) => haystack.includes(word))) return null;

  if (words.every((word) => title.includes(word))) return { kind: "title" };
  const genre = genres.find((g) => words.some((word) => fold(g).includes(word)));
  const person = cast.find((name) => words.some((word) => fold(name).includes(word)));
  // Name the field that did the matching that the title didn't — a person is the more surprising
  // and so the more useful thing to show.
  if (person) return { kind: "cast", value: person };
  if (genre) return { kind: "genre", value: genre };
  return { kind: "title" };
}

/** The line under a search result explaining a non-title match. */
export function reasonLabel(reason: MatchReason | null): string | null {
  if (!reason || reason.kind === "title") return null;
  return reason.kind === "cast" ? `With ${reason.value}` : reason.value;
}

/**
 * The genres worth a row of their own, most-stocked first: only those with at least `min` titles
 * (a one-title "row" is just a card with a heading), and at most `max` of them, so Home stays a
 * front page and doesn't become an index.
 */
export function genreShelves(
  items: CatalogListItem[],
  { min = 2, max = 3 }: { min?: number; max?: number } = {},
): { genre: string; items: CatalogListItem[] }[] {
  const byGenre = new Map<string, CatalogListItem[]>();
  for (const item of items) {
    for (const genre of item.genres ?? []) {
      const list = byGenre.get(genre) ?? [];
      list.push(item);
      byGenre.set(genre, list);
    }
  }
  return [...byGenre.entries()]
    .filter(([, list]) => list.length >= min)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([genre, list]) => ({ genre, items: sortItems(list, "rating") }));
}

/** Every genre present, alphabetically — the browse page's genre chips. */
export function allGenres(items: CatalogListItem[]): string[] {
  return [...new Set(items.flatMap((item) => item.genres ?? []))].sort((a, b) => a.localeCompare(b));
}

export type SortKey = "az" | "za" | "rating" | "newest";

/** Sorts a copy. Anything without the value being sorted on (an unmatched title has no score and
 * no year) goes last rather than first, then falls back to A–Z so the order is stable. */
export function sortItems<T extends CatalogListItem>(items: T[], key: SortKey): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name);
  return [...items].sort((a, b) => {
    if (key === "za") return b.name.localeCompare(a.name);
    if (key === "rating") {
      const ra = a.rating?.average ?? -1;
      const rb = b.rating?.average ?? -1;
      return rb - ra || byName(a, b);
    }
    if (key === "newest") {
      const ya = a.year ?? -1;
      const yb = b.year ?? -1;
      return yb - ya || byName(a, b);
    }
    return byName(a, b);
  });
}
